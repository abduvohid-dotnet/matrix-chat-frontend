import { useEffect, useMemo, useReducer } from "react";
import { RoomMemberEvent, UserEvent } from "matrix-js-sdk";
import { useMatrix } from "../app/providers/useMatrix";

type PresenceUi = {
  label: string;
  online: boolean;
};

function formatPresence(userPresence: string | undefined, lastPresenceTs: number | undefined): PresenceUi {
  if (userPresence === "online") return { label: "online", online: true };
  if (userPresence === "unavailable") return { label: "away", online: false };

  if (typeof lastPresenceTs === "number" && lastPresenceTs > 0) {
    const text = new Date(lastPresenceTs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    return { label: `last seen ${text}`, online: false };
  }

  return { label: "offline", online: false };
}

export function useMatrixRoomStatus(roomId: string | null) {
  const { client, auth } = useMatrix();
  const [, bump] = useReducer((value: number) => value + 1, 0);

  useEffect(() => {
    if (!client || !roomId) return;

    const onTyping = (_event: unknown, member: { roomId?: string }) => {
      if (member.roomId === roomId) bump();
    };

    const onMember = (_event: unknown, member: { roomId?: string }) => {
      if (member.roomId === roomId) bump();
    };

    const onPresence = () => {
      bump();
    };

    client.on(RoomMemberEvent.Typing, onTyping);
    client.on(RoomMemberEvent.Membership, onMember);
    client.on(UserEvent.Presence, onPresence);

    return () => {
      client.off(RoomMemberEvent.Typing, onTyping);
      client.off(RoomMemberEvent.Membership, onMember);
      client.off(UserEvent.Presence, onPresence);
    };
  }, [client, roomId]);

  return useMemo(() => {
    if (!client || !auth || !roomId) {
      return {
        typingText: "",
        presenceText: "offline",
        online: false,
      };
    }

    const room = client.getRoom(roomId);
    if (!room) {
      return {
        typingText: "",
        presenceText: "offline",
        online: false,
      };
    }

    const peers = room
      .getMembers()
      .filter((member) => member.userId !== auth.userId && (member.membership === "join" || member.membership === "invite"));

    const typingUsers = peers.filter((member) => member.typing).map((member) => member.rawDisplayName || member.userId);
    const typingText =
      typingUsers.length === 0
        ? ""
        : typingUsers.length === 1
          ? `${typingUsers[0]} typing...`
          : `${typingUsers.length} people typing...`;

    const peer = peers.find((member) => member.membership === "join") ?? peers[0];
    if (!peer) {
      return {
        typingText,
        presenceText: "offline",
        online: false,
      };
    }

    const user = client.getUser(peer.userId);
    const presence = formatPresence(user?.presence, user?.lastPresenceTs);

    return {
      typingText,
      presenceText: presence.label,
      online: presence.online,
    };
  }, [auth, client, roomId]);
}
