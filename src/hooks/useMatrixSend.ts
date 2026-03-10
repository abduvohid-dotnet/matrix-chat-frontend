import { useMatrix } from "../app/providers/useMatrix";

export function useMatrixSend() {
  const { client } = useMatrix();

  const sendText = async (roomId: string, text: string) => {
    const trimmed = text.trim();
    if (!client || !trimmed) return;

    await client.sendTextMessage(roomId, trimmed);
  };

  return { sendText };
}
