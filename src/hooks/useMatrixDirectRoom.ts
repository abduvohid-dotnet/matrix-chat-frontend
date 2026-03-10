import { useCallback } from "react";
import type { Room } from "matrix-js-sdk";
import { useMatrix } from "../app/providers/useMatrix";

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

function findExistingDirectRoomId(rooms: Room[], myUserId: string, targetUserId: string): string | null {
  for (const room of rooms) {
    if (room.getMyMembership() !== "join") continue;

    const participantIds = new Set(
      room
        .getMembers()
        .filter((member) => member.membership === "join" || member.membership === "invite")
        .map((member) => member.userId),
    );

    if (participantIds.size > 2) continue;
    if (!participantIds.has(myUserId)) continue;
    if (!participantIds.has(targetUserId)) continue;

    return room.roomId;
  }

  return null;
}

export function useMatrixDirectRoom() {
  const { client, auth } = useMatrix();

  const createOrGetDirectRoom = useCallback(
    async (target: string) => {
      if (!client || !auth) {
        throw new Error("Matrix client is not ready");
      }

      const targetUserId = normalizeUserId(target, auth.userId);
      if (!targetUserId) throw new Error("User ID is required");
      if (targetUserId === auth.userId) throw new Error("O'zingizga yozish uchun room ochib bo'lmaydi");

      const existingRoomId = findExistingDirectRoomId(client.getRooms(), auth.userId, targetUserId);
      if (existingRoomId) return existingRoomId;

      const created = await client.createRoom({
        is_direct: true,
        invite: [targetUserId],
      });

      return created.room_id;
    },
    [auth, client],
  );

  return { createOrGetDirectRoom };
}
