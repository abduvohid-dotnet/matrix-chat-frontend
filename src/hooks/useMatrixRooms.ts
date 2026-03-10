import { useEffect, useMemo, useState } from "react";
import { ClientEvent, RoomEvent, RoomMemberEvent, UserEvent, type Room } from "matrix-js-sdk";
import { useMatrix } from "../app/providers/useMatrix";

export function useMatrixRooms() {
  const { client } = useMatrix();
  const [rooms, setRooms] = useState<Room[]>([]);

  useEffect(() => {
    if (!client) return;

    const refresh = () => setRooms(client.getRooms());

    refresh();

    client.on(ClientEvent.Room, refresh);
    client.on(RoomEvent.Timeline, refresh);
    client.on(RoomMemberEvent.Typing, refresh);
    client.on(RoomMemberEvent.Membership, refresh);
    client.on(UserEvent.Presence, refresh);

    return () => {
      client.off(ClientEvent.Room, refresh);
      client.off(RoomEvent.Timeline, refresh);
      client.off(RoomMemberEvent.Typing, refresh);
      client.off(RoomMemberEvent.Membership, refresh);
      client.off(UserEvent.Presence, refresh);
    };
  }, [client]);

  const sorted = useMemo(() => {
    return [...rooms].sort((a, b) => (b.getLastActiveTimestamp() ?? 0) - (a.getLastActiveTimestamp() ?? 0));
  }, [rooms]);

  return { rooms: sorted };
}
