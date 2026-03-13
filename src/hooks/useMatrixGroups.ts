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

export type GroupMemberSummary = {
  userId: string;
  displayName: string;
  membership: string;
  powerLevel: number;
  isCreator: boolean;
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

  return {
    users_default: 0,
    events_default: 0,
    state_default: 100,
    invite: 50,
    redact: 50,
    kick: 75,
    ban: 75,
    users: {},
    events: {},
    ...content,
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
    if (!room) return [];

    return room
      .getMembers()
      .filter((member) => member.membership === "join" || member.membership === "invite")
      .map((member) => ({
        userId: member.userId,
        displayName: member.rawDisplayName || member.userId,
        membership: member.membership ?? "leave",
        powerLevel: getMemberPowerLevel(room, member.userId, powerLevels),
        isCreator: creatorUserId === member.userId,
      }))
      .sort((a, b) => b.powerLevel - a.powerLevel || a.displayName.localeCompare(b.displayName));
  }, [creatorUserId, powerLevels, room]);

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

  return {
    members,
    creatorUserId,
    myPowerLevel,
    powerLevels,
    createGroup,
    inviteUsers,
    setMemberPowerLevel,
    updatePermissionLevels,
  };
}
