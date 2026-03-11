export const FORWARDED_FROM_KEY = "com.uzinfocom.forwarded_from";

export type MatrixForwardMeta = {
  sender: string;
  eventId: string | null;
  roomId: string | null;
};
