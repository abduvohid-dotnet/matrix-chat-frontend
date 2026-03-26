import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EventType, MsgType, type Room, type MatrixEvent } from "matrix-js-sdk";
import {
  GroupCallEvent,
  GroupCallIntent,
  GroupCallState,
  GroupCallTerminationReason,
  GroupCallType,
  GroupCall,
} from "matrix-js-sdk/lib/webrtc/groupCall";
import { GroupCallEventHandlerEvent } from "matrix-js-sdk/lib/webrtc/groupCallEventHandler";
import type { CallFeed } from "matrix-js-sdk/lib/webrtc/callFeed";
import { useMatrix } from "../app/providers/useMatrix";

type RemoteFeedSummary = {
  id: string;
  userId: string;
  displayName: string;
  stream: MediaStream;
};

type GroupVoiceChatState = {
  call: GroupCall | null;
  roomId: string | null;
  state: GroupCallState | null;
  joined: boolean;
  active: boolean;
  startedBy: string | null;
  localStream: MediaStream | null;
  remoteFeeds: RemoteFeedSummary[];
  micMuted: boolean;
  participantCount: number;
  participantNames: string[];
  creationTs: number | null;
  error: string | null;
};

const INITIAL_STATE: GroupVoiceChatState = {
  call: null,
  roomId: null,
  state: null,
  joined: false,
  active: false,
  startedBy: null,
  localStream: null,
  remoteFeeds: [],
  micMuted: false,
  participantCount: 0,
  participantNames: [],
  creationTs: null,
  error: null,
};

const ROOM_STATE_EVENTS = "RoomState.events";
const GROUP_VOICE_CHAT_STATE_EVENT_TYPE = "com.uzinfocom.group_voice_chat";
const GROUP_CALL_EVENT_TYPE = EventType.GroupCallPrefix;
const GROUP_CALL_MEMBER_EVENT_TYPE = EventType.GroupCallMemberPrefix;

function formatCallDuration(durationMs: number): string {
  const totalSeconds = Math.max(1, Math.round(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function toRemoteFeedSummary(feed: CallFeed): RemoteFeedSummary {
  const member = feed.getMember();
  return {
    id: `${feed.userId}-${feed.deviceId ?? "unknown"}-${feed.stream.id}`,
    userId: feed.userId,
    displayName: member?.rawDisplayName || feed.userId,
    stream: feed.stream,
  };
}

function hasActiveVoiceCallState(room: Room | null): boolean {
  return getActiveVoiceCallStateEvents(room).length > 0;
}

function getActiveVoiceCallStateMeta(room: Room | null): { eventId: string | null; createdTs: number | null } | null {
  const list = getActiveVoiceCallStateEvents(room);
  const current = list[0];
  if (!current) return null;

  return {
    eventId: current.getStateKey() ?? null,
    createdTs: current.getTs() ?? null,
  };
}

function getLatestActiveVoiceCallStateEvent(room: Room | null): MatrixEvent | null {
  return getActiveVoiceCallStateEvents(room)[0] ?? null;
}

function getActiveVoiceCallStateEvents(room: Room | null) {
  if (!room) return [];

  const events = room.currentState.getStateEvents(EventType.GroupCallPrefix);
  return (Array.isArray(events) ? events : events ? [events] : [])
    .filter((event) => {
      if (event.isRedacted()) return false;
      const content = event.getContent() as {
        "m.type"?: unknown;
        "m.terminated"?: unknown;
      };
      return content["m.type"] === GroupCallType.Voice && !content["m.terminated"];
    })
    .sort((a, b) => b.getTs() - a.getTs());
}

function getSharedGroupVoiceChatState(room: Room | null): {
  active: boolean;
  startedAt: number | null;
  startedBy: string | null;
} | null {
  if (!room) return null;

  const event = room.currentState.getStateEvents(GROUP_VOICE_CHAT_STATE_EVENT_TYPE as never, "");
  if (!event || event.isRedacted()) return null;

  const content = event.getContent() as {
    active?: unknown;
    startedAt?: unknown;
    startedBy?: unknown;
  };

  return {
    active: content.active === true,
    startedAt: typeof content.startedAt === "number" && Number.isFinite(content.startedAt) ? content.startedAt : null,
    startedBy: typeof content.startedBy === "string" ? content.startedBy : null,
  };
}

function getGroupVoiceManageLevel(room: Room | null): number {
  const content = room?.currentState.getStateEvents(EventType.RoomPowerLevels, "")?.getContent() as
    | {
        state_default?: unknown;
        events?: Record<string, unknown>;
      }
    | undefined;

  const stateDefault = typeof content?.state_default === "number" && Number.isFinite(content.state_default)
    ? content.state_default
    : 100;

  const groupCallLevel = typeof content?.events?.[GROUP_CALL_EVENT_TYPE] === "number" &&
      Number.isFinite(content.events[GROUP_CALL_EVENT_TYPE])
    ? (content.events[GROUP_CALL_EVENT_TYPE] as number)
    : stateDefault;

  const sharedStateLevel = typeof content?.events?.[GROUP_VOICE_CHAT_STATE_EVENT_TYPE] === "number" &&
      Number.isFinite(content.events[GROUP_VOICE_CHAT_STATE_EVENT_TYPE])
    ? (content.events[GROUP_VOICE_CHAT_STATE_EVENT_TYPE] as number)
    : stateDefault;

  return Math.max(groupCallLevel, sharedStateLevel);
}

function getGroupVoiceJoinLevel(room: Room | null): number {
  const content = room?.currentState.getStateEvents(EventType.RoomPowerLevels, "")?.getContent() as
    | {
        state_default?: unknown;
        events?: Record<string, unknown>;
      }
    | undefined;

  const stateDefault = typeof content?.state_default === "number" && Number.isFinite(content.state_default)
    ? content.state_default
    : 100;

  return typeof content?.events?.[GROUP_CALL_MEMBER_EVENT_TYPE] === "number" &&
    Number.isFinite(content.events[GROUP_CALL_MEMBER_EVENT_TYPE])
    ? (content.events[GROUP_CALL_MEMBER_EVENT_TYPE] as number)
    : stateDefault;
}

export function useMatrixGroupVoiceChat(roomId: string | null) {
  const { client, auth } = useMatrix();
  const [groupCallState, setGroupCallState] = useState<GroupVoiceChatState>(INITIAL_STATE);
  const activeGroupCallRef = useRef<GroupCall | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  const sendSystemNotice = useCallback(
    async (targetRoomId: string, body: string) => {
      if (!client) return;

      await client.sendEvent(targetRoomId, EventType.RoomMessage, {
        msgtype: MsgType.Notice,
        body,
      });
    },
    [client],
  );

  const writeSharedState = useCallback(
    async (
      targetRoomId: string,
      payload: {
        active: boolean;
        startedAt: number | null;
        startedBy: string | null;
      },
    ) => {
      if (!client) return;

      await client.sendStateEvent(targetRoomId, GROUP_VOICE_CHAT_STATE_EVENT_TYPE as never, payload as never, "");
    },
    [client],
  );

  const ensureGroupVoiceMemberPermission = useCallback(
    async (room: Room | null) => {
      if (!client || !room) return;

      const powerLevelsEvent = room.currentState.getStateEvents(EventType.RoomPowerLevels, "");
      const content = (powerLevelsEvent?.getContent() ?? {}) as {
        events?: Record<string, unknown>;
      } & Record<string, unknown>;

      const currentLevel = content.events?.[GROUP_CALL_MEMBER_EVENT_TYPE];
      if (typeof currentLevel === "number" && Number.isFinite(currentLevel)) {
        return;
      }

      await client.sendStateEvent(
        room.roomId,
        EventType.RoomPowerLevels,
        {
          ...content,
          events: {
            ...(content.events ?? {}),
            [GROUP_CALL_MEMBER_EVENT_TYPE]: 0,
          },
        } as never,
        "",
      );
    },
    [client],
  );

  const terminateGroupVoiceStateEvents = useCallback(
    async (room: Room | null, keepStateKey?: string | null) => {
      if (!client || !room) return;

      const activeEvents = getActiveVoiceCallStateEvents(room);
      for (const event of activeEvents) {
        const stateKey = event.getStateKey();
        if (!stateKey || stateKey === keepStateKey) continue;

        const content = event.getContent() as Record<string, unknown>;
        const nextContent = {
          ...content,
          "m.terminated": GroupCallTerminationReason.CallEnded,
        };
        await client.sendStateEvent(
          room.roomId,
          EventType.GroupCallPrefix,
          nextContent as never,
          stateKey,
        );
      }
    },
    [client],
  );

  const getOrCreateLatestRoomVoiceCall = useCallback(
    async (targetRoomId: string): Promise<GroupCall | null> => {
      if (!client) return null;

      const room = client.getRoom(targetRoomId);
      if (!room) return null;

      const latestEvent = getLatestActiveVoiceCallStateEvent(room);
      if (!latestEvent) {
        return client.getGroupCallForRoom(targetRoomId);
      }

      const latestStateKey = latestEvent.getStateKey();
      const existing = client.getGroupCallForRoom(targetRoomId);
      if (existing && existing.groupCallId === latestStateKey && existing.state !== GroupCallState.Ended) {
        return existing;
      }

      if (existing && existing.groupCallId !== latestStateKey && existing.state !== GroupCallState.Ended) {
        await existing.terminate(false);
      }

      const content = latestEvent.getContent() as {
        "m.intent"?: unknown;
        "m.type"?: unknown;
        "io.element.ptt"?: unknown;
        "dataChannelsEnabled"?: unknown;
        "dataChannelOptions"?: unknown;
        "io.element.livekit_service_url"?: unknown;
      };

      const intent = Object.values(GroupCallIntent).includes(content["m.intent"] as GroupCallIntent)
        ? (content["m.intent"] as GroupCallIntent)
        : GroupCallIntent.Room;
      const type = content["m.type"] === GroupCallType.Video ? GroupCallType.Video : GroupCallType.Voice;
      const isPtt = content["io.element.ptt"] === true;
      const dataChannelsEnabled = content["dataChannelsEnabled"] === true;
      const livekitUrl =
        typeof content["io.element.livekit_service_url"] === "string"
          ? content["io.element.livekit_service_url"]
          : undefined;

      const materialized = new GroupCall(
        client,
        room,
        type,
        isPtt,
        intent,
        latestStateKey ?? undefined,
        dataChannelsEnabled || client.isVoipWithNoMediaAllowed,
        undefined,
        client.isVoipWithNoMediaAllowed,
        client.useLivekitForGroupCalls,
        livekitUrl,
      );

      client.groupCallEventHandler?.groupCalls.set(targetRoomId, materialized);
      return materialized;
    },
    [client],
  );

  const getMyPowerLevel = useCallback(
    (targetRoomId: string): number => {
      if (!client || !auth) return 0;

      const room = client.getRoom(targetRoomId);
      const member = room?.getMember(auth.userId);
      if (member && typeof member.powerLevel === "number") {
        return Number.isFinite(member.powerLevel) ? member.powerLevel : 100;
      }

      return 0;
    },
    [auth, client],
  );

  const detachGroupCall = useCallback(() => {
    cleanupRef.current?.();
    cleanupRef.current = null;
    activeGroupCallRef.current = null;
  }, []);

  const resetGroupCallState = useCallback(() => {
    detachGroupCall();
    setGroupCallState(INITIAL_STATE);
  }, [detachGroupCall]);

  const syncFromGroupCall = useCallback((call: GroupCall, error?: string | null) => {
    const sharedState = getSharedGroupVoiceChatState(call.room);
    const remoteFeeds = call.userMediaFeeds
      .filter((feed) => !feed.isLocal())
      .map(toRemoteFeedSummary);
    const allParticipants = Array.from(call.participants.keys());
    const participantNames = allParticipants
      .filter((member) => member.userId !== auth?.userId)
      .map((member) => member.rawDisplayName || member.userId)
      .filter((name, index, list) => list.indexOf(name) === index);
    const joined = call.hasLocalParticipant();

    setGroupCallState({
      call,
      roomId: call.room.roomId,
      state: call.state,
      joined,
      active: call.state !== GroupCallState.Ended,
      startedBy: sharedState?.startedBy ?? null,
      localStream: call.localCallFeed?.stream ?? null,
      remoteFeeds,
      micMuted: call.isMicrophoneMuted(),
      participantCount: allParticipants.length,
      participantNames,
      creationTs: call.creationTs,
      error: error ?? null,
    });
  }, [auth?.userId]);

  const attachGroupCall = useCallback(
    (call: GroupCall) => {
      if (activeGroupCallRef.current === call) {
        syncFromGroupCall(call, groupCallState.error);
        return;
      }

      cleanupRef.current?.();
      activeGroupCallRef.current = call;
      syncFromGroupCall(call, null);

      const isActiveCall = () => activeGroupCallRef.current === call;

      const onStateChanged = (newState: GroupCallState) => {
        if (!isActiveCall()) return;
        if (newState === GroupCallState.Ended) {
          resetGroupCallState();
          return;
        }
        syncFromGroupCall(call, null);
      };

      const onUserMediaFeedsChanged = () => {
        if (!isActiveCall()) return;
        syncFromGroupCall(call, null);
      };

      const onParticipantsChanged = () => {
        if (!isActiveCall()) return;
        syncFromGroupCall(call, null);
      };

      const onLocalMuteStateChanged = () => {
        if (!isActiveCall()) return;
        syncFromGroupCall(call, null);
      };

      const onError = (error: Error) => {
        if (!isActiveCall()) return;
        syncFromGroupCall(call, error.message);
      };

      call.on(GroupCallEvent.GroupCallStateChanged, onStateChanged);
      call.on(GroupCallEvent.UserMediaFeedsChanged, onUserMediaFeedsChanged);
      call.on(GroupCallEvent.ParticipantsChanged, onParticipantsChanged);
      call.on(GroupCallEvent.LocalMuteStateChanged, onLocalMuteStateChanged);
      call.on(GroupCallEvent.Error, onError);

      cleanupRef.current = () => {
        call.off(GroupCallEvent.GroupCallStateChanged, onStateChanged);
        call.off(GroupCallEvent.UserMediaFeedsChanged, onUserMediaFeedsChanged);
        call.off(GroupCallEvent.ParticipantsChanged, onParticipantsChanged);
        call.off(GroupCallEvent.LocalMuteStateChanged, onLocalMuteStateChanged);
        call.off(GroupCallEvent.Error, onError);
      };
    },
    [groupCallState.error, resetGroupCallState, syncFromGroupCall],
  );

  useEffect(() => {
    if (!client || !roomId) {
      resetGroupCallState();
      return;
    }

    let cancelled = false;
    const room = client.getRoom(roomId);

    const recoverExistingGroupCall = async () => {
      const sharedState = getSharedGroupVoiceChatState(room);

      try {
        await client.waitUntilRoomReadyForGroupCalls(roomId);
      } catch {
        // ignore initial readiness race
      }

      if (cancelled) return;

      const existing = await getOrCreateLatestRoomVoiceCall(roomId);
      if (existing && existing.type === GroupCallType.Voice && existing.state !== GroupCallState.Ended) {
        attachGroupCall(existing);
        return;
      }

      if (sharedState?.active || hasActiveVoiceCallState(room)) {
        setGroupCallState((prev) => ({
          ...prev,
          roomId,
          active: true,
          joined: false,
          startedBy: sharedState?.startedBy ?? null,
          state: prev.state ?? GroupCallState.LocalCallFeedUninitialized,
          creationTs: sharedState?.startedAt ?? prev.creationTs ?? null,
          error: null,
        }));
        return;
      }

      resetGroupCallState();
    };

    const onIncoming = (call: GroupCall) => {
      if (call.room.roomId !== roomId || call.type !== GroupCallType.Voice) return;
      attachGroupCall(call);
    };

    const onOutgoing = (call: GroupCall) => {
      if (call.room.roomId !== roomId || call.type !== GroupCallType.Voice) return;
      attachGroupCall(call);
    };

    const onEnded = (call: GroupCall) => {
      if (call.room.roomId !== roomId || activeGroupCallRef.current !== call) return;
      resetGroupCallState();
    };

    const onRoomStateChanged = () => {
      void recoverExistingGroupCall();
    };

    void recoverExistingGroupCall();

    client.on(GroupCallEventHandlerEvent.Incoming, onIncoming);
    client.on(GroupCallEventHandlerEvent.Outgoing, onOutgoing);
    client.on(GroupCallEventHandlerEvent.Ended, onEnded);
    room?.currentState.on(ROOM_STATE_EVENTS as never, onRoomStateChanged as never);

    return () => {
      cancelled = true;
      client.off(GroupCallEventHandlerEvent.Incoming, onIncoming);
      client.off(GroupCallEventHandlerEvent.Outgoing, onOutgoing);
      client.off(GroupCallEventHandlerEvent.Ended, onEnded);
      room?.currentState.off(ROOM_STATE_EVENTS as never, onRoomStateChanged as never);
    };
  }, [attachGroupCall, client, getOrCreateLatestRoomVoiceCall, resetGroupCallState, roomId]);

  useEffect(() => {
    return () => {
      detachGroupCall();
    };
  }, [detachGroupCall]);

  const start = useCallback(
    async (targetRoomId: string) => {
      if (!client) return;
      const room = client.getRoom(targetRoomId);
      const requiredLevel = getGroupVoiceManageLevel(room);
      if (getMyPowerLevel(targetRoomId) < requiredLevel) {
        setGroupCallState((prev) => ({ ...prev, error: "Faqat owner yoki admin group voice chat boshlay oladi" }));
        return;
      }

      await ensureGroupVoiceMemberPermission(room);

      const sharedState = getSharedGroupVoiceChatState(room);
      const activeMeta = getActiveVoiceCallStateMeta(room);
      let createdNow = false;
      let call = await getOrCreateLatestRoomVoiceCall(targetRoomId);

      await terminateGroupVoiceStateEvents(room, activeMeta?.eventId ?? null);

      if ((sharedState?.active || activeMeta) && (!call || call.type !== GroupCallType.Voice || call.state === GroupCallState.Ended)) {
        try {
          await client.waitUntilRoomReadyForGroupCalls(targetRoomId);
        } catch {
          // ignore room readiness race
        }

        call = await getOrCreateLatestRoomVoiceCall(targetRoomId);
        if (call && call.type === GroupCallType.Voice && call.state !== GroupCallState.Ended) {
          attachGroupCall(call);
          if (!call.hasLocalParticipant()) {
            await call.enter();
          }
          syncFromGroupCall(call, null);
          return;
        }

        setGroupCallState((prev) => ({
          ...prev,
          roomId: targetRoomId,
          active: true,
          joined: false,
          startedBy: sharedState?.startedBy ?? null,
          state: GroupCallState.LocalCallFeedUninitialized,
          creationTs: sharedState?.startedAt ?? activeMeta?.createdTs ?? null,
          error: null,
        }));
        return;
      }

      if (!call || call.type !== GroupCallType.Voice || call.state === GroupCallState.Ended) {
        await client.waitUntilRoomReadyForGroupCalls(targetRoomId);
        call = await client.createGroupCall(targetRoomId, GroupCallType.Voice, false, GroupCallIntent.Room);
        createdNow = true;
      }

      attachGroupCall(call);
      if (!call.hasLocalParticipant()) {
        await call.enter();
      }
      if (createdNow) {
        await writeSharedState(targetRoomId, {
          active: true,
          startedAt: call.creationTs ?? Date.now(),
          startedBy: auth?.userId ?? null,
        });
        await sendSystemNotice(targetRoomId, "Guruh ovozli chati boshlandi");
      }
      syncFromGroupCall(call, null);
    },
    [
      attachGroupCall,
      auth?.userId,
      client,
      ensureGroupVoiceMemberPermission,
      getOrCreateLatestRoomVoiceCall,
      getMyPowerLevel,
      sendSystemNotice,
      syncFromGroupCall,
      terminateGroupVoiceStateEvents,
      writeSharedState,
    ],
  );

  const join = useCallback(async () => {
    if (client && roomId) {
      const room = client.getRoom(roomId);
      const requiredLevel = getGroupVoiceJoinLevel(room);
      if (getMyPowerLevel(roomId) < requiredLevel) {
        setGroupCallState((prev) => ({
          ...prev,
          error: "Bu groupda voice chatga qo'shilish uchun ruxsat yo'q",
        }));
        return;
      }
    }

    let call = activeGroupCallRef.current;
    if (!call && client && roomId) {
      try {
        await client.waitUntilRoomReadyForGroupCalls(roomId);
      } catch {
        // ignore room readiness race
      }
      call = await getOrCreateLatestRoomVoiceCall(roomId);
      if (call && call.type === GroupCallType.Voice && call.state !== GroupCallState.Ended) {
        attachGroupCall(call);
      }
    }

    if (!call) return;
    await call.enter();
    syncFromGroupCall(call, null);
  }, [attachGroupCall, client, getMyPowerLevel, getOrCreateLatestRoomVoiceCall, roomId, syncFromGroupCall]);

  const leave = useCallback(() => {
    const call = activeGroupCallRef.current;
    if (!call) return;
    call.leave();
    syncFromGroupCall(call, null);
  }, [syncFromGroupCall]);

  const end = useCallback(async () => {
    const call = activeGroupCallRef.current;
    if (!call) return;
    const requiredLevel = getGroupVoiceManageLevel(call.room);
    if (getMyPowerLevel(call.room.roomId) < requiredLevel) {
      setGroupCallState((prev) => ({ ...prev, error: "Faqat owner yoki admin group voice chatni yakunlay oladi" }));
      return;
    }

    const duration = call.creationTs ? formatCallDuration(Date.now() - call.creationTs) : null;
    const targetRoomId = call.room.roomId;

    await call.terminate();
    await terminateGroupVoiceStateEvents(call.room);
    await writeSharedState(targetRoomId, {
      active: false,
      startedAt: null,
      startedBy: null,
    });
    await sendSystemNotice(
      targetRoomId,
      duration
        ? `Guruh ovozli chati yakunlandi. Davomiyligi: ${duration}`
        : "Guruh ovozli chati yakunlandi",
    );
    resetGroupCallState();
  }, [getMyPowerLevel, resetGroupCallState, sendSystemNotice, terminateGroupVoiceStateEvents, writeSharedState]);

  const toggleMicrophone = useCallback(async () => {
    const call = activeGroupCallRef.current;
    if (!call) return;
    await call.setMicrophoneMuted(!call.isMicrophoneMuted());
    syncFromGroupCall(call, null);
  }, [syncFromGroupCall]);

  const remoteParticipantNames = useMemo(
    () => groupCallState.participantNames,
    [groupCallState.participantNames],
  );

  const manageLevel = useMemo(
    () => getGroupVoiceManageLevel(client && roomId ? client.getRoom(roomId) : null),
    [client, roomId],
  );

  const canManage = useMemo(
    () => (roomId ? getMyPowerLevel(roomId) >= manageLevel : false),
    [getMyPowerLevel, manageLevel, roomId],
  );

  return {
    ...groupCallState,
    remoteParticipantNames,
    manageLevel,
    canManage,
    start,
    join,
    leave,
    end,
    toggleMicrophone,
  };
}
