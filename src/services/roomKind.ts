import type { Room } from "matrix-js-sdk";

export function getDirectPeerUserId(room: Room, currentUserId: string): string | null {
  if (room.getMyMembership() !== "join") return null;

  const participants = room
    .getMembers()
    .filter(
      (member) =>
        member.membership === "join" || member.membership === "invite",
    );

  if (participants.length > 2) return null;

  const peers = participants.filter((member) => member.userId !== currentUserId);
  if (peers.length !== 1) return null;

  return peers[0].userId;
}

export function isDirectRoom(room: Room, currentUserId: string): boolean {
  return Boolean(getDirectPeerUserId(room, currentUserId));
}
