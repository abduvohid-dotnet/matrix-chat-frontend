import { useEffect, useMemo, useReducer } from "react";
import { RoomMemberEvent, UserEvent } from "matrix-js-sdk";
import { useMatrix } from "../app/providers/useMatrix";
import { formatPresenceStatus, formatTypingSummary } from "../services/presence";

export function useMatrixRoomStatus(roomId: string | null) {
  const { client, auth } = useMatrix();
  const [version, bump] = useReducer((value: number) => value + 1, 0);

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
    const refreshTimer = window.setInterval(() => {
      bump();
    }, 30_000);

    return () => {
      window.clearInterval(refreshTimer);
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

    const joinedPeers = peers.filter((member) => member.membership === "join");
    const invitedPeer = peers.find((member) => member.membership === "invite");
    const typingUsers = joinedPeers.filter((member) => member.typing).map((member) => member.rawDisplayName || member.userId);
    const typingText = formatTypingSummary(typingUsers);

    const peer = joinedPeers[0];
    if (!peer) {
      return {
        typingText,
        presenceText: invitedPeer ? "invited" : "offline",
        online: false,
      };
    }

    const user = client.getUser(peer.userId);
    const presence = formatPresenceStatus(user?.presence, user?.lastPresenceTs);

    return {
      typingText,
      presenceText: presence.label,
      online: presence.online,
    };
  }, [auth, client, roomId, version]);
}
