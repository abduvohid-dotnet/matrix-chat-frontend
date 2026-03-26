import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import { EventType, Preset, type Room } from "matrix-js-sdk";
import { useMatrix } from "../app/providers/useMatrix";

type RoomPowerLevelsContent = {
  users?: Record<string, number>;
  users_default?: number;
  invite?: number;
  redact?: number;
  kick?: number;
  ban?: number;
  state_default?: number;
  events_default?: number;
  events?: Record<string, number>;
};

const GROUP_CALL_EVENT_TYPE = EventType.GroupCallPrefix;
const GROUP_CALL_MEMBER_EVENT_TYPE = EventType.GroupCallMemberPrefix;
const GROUP_VOICE_CHAT_STATE_EVENT_TYPE = "com.uzinfocom.group_voice_chat";

export type GroupMemberSummary = {
  userId: string;
  displayName: string;
  membership: string;
  powerLevel: number;
  isCreator: boolean;
  isSelf: boolean;
  avatarUrl: string | null;
  statusText: string;
  statusTone: "online" | "offline" | "invited";
  canRemove: boolean;
};

const ROOM_STATE_EVENTS = "RoomState.events";
const ROOM_MEMBERS_EVENTS = "RoomState.members";

function normalizeUserId(input: string, myUserId: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";

  const fallbackDomain = myUserId.includes(":") ? myUserId.split(":")[1] : "";

  if (trimmed.startsWith("@")) {
    if (trimmed.includes(":")) return trimmed;
    return fallbackDomain ? `${trimmed}:${fallbackDomain}` : trimmed;
  }

  if (trimmed.includes(":")) return `@${trimmed}`;
  return fallbackDomain ? `@${trimmed}:${fallbackDomain}` : `@${trimmed}`;
}

function parseInviteList(input: string, myUserId: string): string[] {
  const parts = input
    .split(/[,\n]/)
    .map((item) => normalizeUserId(item, myUserId))
    .filter(Boolean)
    .filter((userId) => userId !== myUserId);

  return [...new Set(parts)];
}

function getPowerLevelsState(room: Room | null): RoomPowerLevelsContent {
  const content = room?.currentState.getStateEvents(EventType.RoomPowerLevels, "")?.getContent() as
    | RoomPowerLevelsContent
    | undefined;

  const defaultEvents = {
    [GROUP_CALL_EVENT_TYPE]: 100,
    [GROUP_CALL_MEMBER_EVENT_TYPE]: 0,
    [GROUP_VOICE_CHAT_STATE_EVENT_TYPE]: 100,
  };

  return {
    users_default: 0,
    events_default: 0,
    state_default: 100,
    invite: 50,
    redact: 50,
    kick: 75,
    ban: 75,
    users: {},
    ...content,
    events: {
      ...defaultEvents,
      ...(content?.events ?? {}),
    },
  };
}

function getCreatorUserId(room: Room | null): string | null {
  const createContent = room?.currentState.getStateEvents(EventType.RoomCreate, "")?.getContent() as
    | { creator?: unknown }
    | undefined;
  return typeof createContent?.creator === "string" && createContent.creator.length > 0
    ? createContent.creator
    : null;
}

function getMemberPowerLevel(room: Room | null, userId: string | null, powerLevels: RoomPowerLevelsContent): number {
  if (!room || !userId) return powerLevels.users_default ?? 0;

  const member = room.getMember(userId);
  if (member && typeof member.powerLevel === "number") {
    return Number.isFinite(member.powerLevel) ? member.powerLevel : 100;
  }

  if (getCreatorUserId(room) === userId) {
    return 100;
  }

  return powerLevels.users?.[userId] ?? powerLevels.users_default ?? 0;
}

function getMemberStatus(
  client: ReturnType<typeof useMatrix>["client"],
  userId: string,
  membership: string,
  typing: boolean,
): { text: string; tone: "online" | "offline" | "invited" } {
  if (membership === "invite") {
    return { text: "invited", tone: "invited" };
  }

  if (typing) {
    return { text: "typing...", tone: "online" };
  }

  const user = client?.getUser(userId);
  if (user?.presence === "online") {
    return { text: "online", tone: "online" };
  }

  if (user?.presence === "unavailable") {
    return { text: "away", tone: "offline" };
  }

  return { text: "last seen recently", tone: "offline" };
}

function getMemberAvatarUrl(
  client: ReturnType<typeof useMatrix>["client"],
  room: Room | null,
  userId: string,
): string | null {
  if (!client || !room) return null;

  const avatarMxc = room.getMember(userId)?.events.member?.getContent()?.avatar_url;
  if (typeof avatarMxc !== "string" || !avatarMxc) return null;

  return client.mxcUrlToHttp(avatarMxc, 96, 96, "crop") ?? client.mxcUrlToHttp(avatarMxc) ?? null;
}

function canRemoveMember(
  actorLevel: number,
  targetLevel: number,
  kickLevel: number,
  options: { isCreator: boolean; isSelf: boolean },
): boolean {
  if (options.isCreator || options.isSelf) return false;
  if (actorLevel < kickLevel) return false;
  return actorLevel > targetLevel;
}

export function useMatrixGroups(roomId: string | null) {
  const { client, auth } = useMatrix();
  const [stateVersion, bumpVersion] = useReducer((value: number) => value + 1, 0);
  const [optimisticPowerLevelsByRoom, setOptimisticPowerLevelsByRoom] = useState<Record<string, RoomPowerLevelsContent>>({});

  useEffect(() => {
    if (!client || !roomId) return;

    const room = client.getRoom(roomId);
    if (!room) return;

    const refresh = () => bumpVersion();
    room.currentState.on(ROOM_STATE_EVENTS as never, refresh as never);
    room.currentState.on(ROOM_MEMBERS_EVENTS as never, refresh as never);

    return () => {
      room.currentState.off(ROOM_STATE_EVENTS as never, refresh as never);
      room.currentState.off(ROOM_MEMBERS_EVENTS as never, refresh as never);
    };
  }, [client, roomId]);

  useEffect(() => {
    if (!roomId) return;

    setOptimisticPowerLevelsByRoom((prev) => {
      if (!prev[roomId]) return prev;
      const { [roomId]: _removed, ...rest } = prev;
      return rest;
    });
  }, [roomId, stateVersion]);

  const room = client && roomId ? client.getRoom(roomId) : null;
  const persistedPowerLevels = useMemo(() => getPowerLevelsState(room), [room, stateVersion]);
  const powerLevels = useMemo(
    () => optimisticPowerLevelsByRoom[roomId ?? ""] ?? persistedPowerLevels,
    [optimisticPowerLevelsByRoom, persistedPowerLevels, roomId],
  );
  const creatorUserId = useMemo(() => getCreatorUserId(room), [room, stateVersion]);
  const myPowerLevel = useMemo(() => {
    if (!auth) return 0;
    return getMemberPowerLevel(room, auth.userId, powerLevels);
  }, [auth, powerLevels, room]);

  const members = useMemo<GroupMemberSummary[]>(() => {
    if (!room || !auth) return [];

    const kickLevel = powerLevels.kick ?? 75;

    return room
      .getMembers()
      .filter((member) => member.membership === "join" || member.membership === "invite")
      .map((member) => {
        const status = getMemberStatus(client, member.userId, member.membership ?? "leave", Boolean(member.typing));
        const powerLevel = getMemberPowerLevel(room, member.userId, powerLevels);
        const isCreator = creatorUserId === member.userId;
        const isSelf = auth.userId === member.userId;

        return {
          userId: member.userId,
          displayName: member.rawDisplayName || member.userId,
          membership: member.membership ?? "leave",
          powerLevel,
          isCreator,
          isSelf,
          avatarUrl: getMemberAvatarUrl(client, room, member.userId),
          statusText: status.text,
          statusTone: status.tone,
          canRemove: canRemoveMember(myPowerLevel, powerLevel, kickLevel, { isCreator, isSelf }),
        };
      })
      .sort((a, b) => b.powerLevel - a.powerLevel || a.displayName.localeCompare(b.displayName));
  }, [auth, client, creatorUserId, myPowerLevel, powerLevels, room]);

  const createGroup = useCallback(
    async (name: string, inviteInput: string) => {
      if (!client || !auth) {
        throw new Error("Matrix client is not ready");
      }

      const trimmedName = name.trim();
      if (!trimmedName) {
        throw new Error("Group name is required");
      }

      const invite = parseInviteList(inviteInput, auth.userId);

      const created = await client.createRoom({
        name: trimmedName,
        preset: Preset.PrivateChat,
        invite,
        is_direct: false,
        power_level_content_override: {
          users_default: 0,
          events_default: 0,
          state_default: 100,
          invite: 50,
          redact: 50,
          kick: 75,
          ban: 75,
          events: {
            [GROUP_CALL_EVENT_TYPE]: 100,
            [GROUP_CALL_MEMBER_EVENT_TYPE]: 0,
            [GROUP_VOICE_CHAT_STATE_EVENT_TYPE]: 100,
          },
        },
      });

      return created.room_id;
    },
    [auth, client],
  );

  const inviteUsers = useCallback(
    async (targetRoomId: string, inviteInput: string) => {
      if (!client || !auth) {
        throw new Error("Matrix client is not ready");
      }

      const invitees = parseInviteList(inviteInput, auth.userId);
      if (!invitees.length) {
        throw new Error("At least one user is required");
      }

      for (const userId of invitees) {
        await client.invite(targetRoomId, userId);
      }
    },
    [auth, client],
  );

  const setMemberPowerLevel = useCallback(
    async (targetRoomId: string, userId: string, powerLevel: number) => {
      if (!client) throw new Error("Matrix client is not ready");

      const targetRoom = client.getRoom(targetRoomId);
      if (getCreatorUserId(targetRoom) === userId) {
        throw new Error("Room creator role cannot be changed");
      }
      const current = optimisticPowerLevelsByRoom[targetRoomId] ?? getPowerLevelsState(targetRoom);
      const users = { ...(current.users ?? {}) };
      users[userId] = powerLevel;
      const nextState = {
        ...current,
        users,
      };

      setOptimisticPowerLevelsByRoom((prev) => ({
        ...prev,
        [targetRoomId]: nextState,
      }));

      try {
        await client.sendStateEvent(targetRoomId, EventType.RoomPowerLevels, nextState, "");
      } catch (error) {
        setOptimisticPowerLevelsByRoom((prev) => {
          const { [targetRoomId]: _removed, ...rest } = prev;
          return rest;
        });
        throw error;
      }
    },
    [client, optimisticPowerLevelsByRoom],
  );

  const updatePermissionLevels = useCallback(
    async (
      targetRoomId: string,
      next: Partial<Pick<RoomPowerLevelsContent, "invite" | "redact" | "kick" | "ban">>,
    ) => {
      if (!client) throw new Error("Matrix client is not ready");

      const targetRoom = client.getRoom(targetRoomId);
      const current = optimisticPowerLevelsByRoom[targetRoomId] ?? getPowerLevelsState(targetRoom);
      const nextState = {
        ...current,
        ...next,
      };

      setOptimisticPowerLevelsByRoom((prev) => ({
        ...prev,
        [targetRoomId]: nextState,
      }));

      try {
        await client.sendStateEvent(targetRoomId, EventType.RoomPowerLevels, nextState, "");
      } catch (error) {
        setOptimisticPowerLevelsByRoom((prev) => {
          const { [targetRoomId]: _removed, ...rest } = prev;
          return rest;
        });
        throw error;
      }
    },
    [client, optimisticPowerLevelsByRoom],
  );

  const removeMember = useCallback(
    async (targetRoomId: string, userId: string) => {
      if (!client || !auth) {
        throw new Error("Matrix client is not ready");
      }

      const targetRoom = client.getRoom(targetRoomId);
      const current = optimisticPowerLevelsByRoom[targetRoomId] ?? getPowerLevelsState(targetRoom);
      const actorLevel = getMemberPowerLevel(targetRoom, auth.userId, current);
      const targetLevel = getMemberPowerLevel(targetRoom, userId, current);
      const targetIsCreator = getCreatorUserId(targetRoom) === userId;
      const isSelf = auth.userId === userId;

      if (!canRemoveMember(actorLevel, targetLevel, current.kick ?? 75, { isCreator: targetIsCreator, isSelf })) {
        throw new Error("You do not have permission to remove this member");
      }

      await client.kick(targetRoomId, userId, "Removed from group");
    },
    [auth, client, optimisticPowerLevelsByRoom],
  );

  const leaveRoom = useCallback(
    async (targetRoomId: string) => {
      if (!client) {
        throw new Error("Matrix client is not ready");
      }

      await client.leave(targetRoomId);
    },
    [client],
  );

  return {
    roomName: room?.name || "Unnamed group",
    members,
    creatorUserId,
    myPowerLevel,
    powerLevels,
    createGroup,
    inviteUsers,
    setMemberPowerLevel,
    updatePermissionLevels,
    removeMember,
    leaveRoom,
  };
}
