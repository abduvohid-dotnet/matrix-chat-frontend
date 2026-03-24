import { useEffect, useMemo, useState } from "react";
import { ClientEvent, RoomEvent, RoomMemberEvent, UserEvent, type Room } from "matrix-js-sdk";
import { useMatrix } from "../app/providers/useMatrix";
import { getLatestVisibleMessageTimestamp } from "../services/roomActivity";
import { getDirectPeerUserId } from "../services/roomKind";

export function useMatrixRooms() {
  const { client, auth } = useMatrix();
  const [rooms, setRooms] = useState<Room[]>([]);

  useEffect(() => {
    if (!client) return;

    const refresh = () => setRooms(client.getRooms());

    refresh();

    client.on(ClientEvent.Room, refresh);
    client.on(RoomEvent.Timeline, refresh);
    client.on(RoomEvent.Receipt, refresh);
    client.on(RoomMemberEvent.Typing, refresh);
    client.on(RoomMemberEvent.Membership, refresh);
    client.on(UserEvent.Presence, refresh);

    return () => {
      client.off(ClientEvent.Room, refresh);
      client.off(RoomEvent.Timeline, refresh);
      client.off(RoomEvent.Receipt, refresh);
      client.off(RoomMemberEvent.Typing, refresh);
      client.off(RoomMemberEvent.Membership, refresh);
      client.off(UserEvent.Presence, refresh);
    };
  }, [client]);

  const sorted = useMemo(() => {
    const orderedRooms = [...rooms].sort(
      (a, b) => getLatestVisibleMessageTimestamp(b) - getLatestVisibleMessageTimestamp(a),
    );

    if (!auth) return orderedRooms;

    const directRoomByPeer = new Map<string, Room>();
    const nextRooms: Room[] = [];

    orderedRooms.forEach((room) => {
      const directPeerKey = getDirectPeerUserId(room, auth.userId);
      if (!directPeerKey) {
        nextRooms.push(room);
        return;
      }

      if (directRoomByPeer.has(directPeerKey)) return;
      directRoomByPeer.set(directPeerKey, room);
      nextRooms.push(room);
    });

    return nextRooms;
  }, [auth, rooms]);

  return { rooms: sorted };
}
