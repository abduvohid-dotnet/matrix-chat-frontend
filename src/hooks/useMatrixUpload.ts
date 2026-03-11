import { useCallback } from "react";
import { EventType, MsgType } from "matrix-js-sdk";
import { useMatrix } from "../app/providers/useMatrix";
import { buildReplyMessageContent, type MatrixReplyTarget } from "../services/matrixReply";

type UploadResponse = string | { content_uri?: string };
type MediaMessageType = MsgType.Image | MsgType.Video | MsgType.Audio | MsgType.File;
type UploadProgress = { loaded: number; total: number };

export type MatrixUploadResult = {
  mxcUrl: string;
  name: string;
  size: number;
  mime: string;
  msgtype: MediaMessageType;
};

function guessMimeFromFileName(name: string): string {
  const ext = name.toLowerCase().split(".").pop();
  if (!ext) return "application/octet-stream";

  if (["jpg", "jpeg"].includes(ext)) return "image/jpeg";
  if (ext === "png") return "image/png";
  if (ext === "gif") return "image/gif";
  if (ext === "webp") return "image/webp";
  if (ext === "bmp") return "image/bmp";
  if (ext === "svg") return "image/svg+xml";

  if (ext === "mp4") return "video/mp4";
  if (ext === "webm") return "video/webm";
  if (ext === "mov") return "video/quicktime";
  if (ext === "mkv") return "video/x-matroska";
  if (ext === "avi") return "video/x-msvideo";

  if (ext === "mp3") return "audio/mpeg";
  if (ext === "wav") return "audio/wav";
  if (ext === "ogg") return "audio/ogg";
  if (ext === "m4a") return "audio/mp4";
  if (ext === "aac") return "audio/aac";

  return "application/octet-stream";
}

function getMessageTypeByMime(mime: string): MediaMessageType {
  if (mime.startsWith("image/")) return MsgType.Image;
  if (mime.startsWith("video/")) return MsgType.Video;
  if (mime.startsWith("audio/")) return MsgType.Audio;
  return MsgType.File;
}

function normalizeMxcUrl(response: UploadResponse): string {
  const raw = typeof response === "string" ? response : response.content_uri;
  if (typeof raw !== "string" || raw.length === 0) {
    throw new Error("Upload failed: invalid MXC response");
  }
  return raw;
}

export function useMatrixUpload() {
  const { client } = useMatrix();

  const uploadFile = useCallback(
    async (file: File, onProgress?: (progress: UploadProgress) => void): Promise<MatrixUploadResult> => {
      if (!client) {
        throw new Error("Matrix client is not connected");
      }

      const res = (await client.uploadContent(file, {
        type: file.type,
        progressHandler: (progress) => {
          if (onProgress) onProgress(progress);
        },
      })) as UploadResponse;
      const mime = file.type || guessMimeFromFileName(file.name);

      return {
        mxcUrl: normalizeMxcUrl(res),
        name: file.name,
        size: file.size,
        mime,
        msgtype: getMessageTypeByMime(mime),
      };
    },
    [client],
  );

  const sendFileMessage = useCallback(
    async (
      roomId: string,
      file: File,
      onProgress?: (progress: UploadProgress) => void,
      replyTo?: MatrixReplyTarget | null,
    ): Promise<MatrixUploadResult> => {
      if (!client) {
        throw new Error("Matrix client is not connected");
      }

      const uploaded = await uploadFile(file, onProgress);
      const info = {
        mimetype: uploaded.mime,
        size: uploaded.size,
      };

      const sendMessageContent = async (body: string, msgtype: MediaMessageType, url: string, info: { mimetype: string; size: number }) => {
        const content = {
          body,
          msgtype,
          url,
          info,
        };

        if (replyTo) {
          await client.sendEvent(
            roomId,
            EventType.RoomMessage,
            buildReplyMessageContent(body, replyTo, msgtype, { url, info }) as never,
          );
          return;
        }

        await client.sendEvent(roomId, EventType.RoomMessage, content as never);
      };

      if (uploaded.msgtype === MsgType.Image) {
        await sendMessageContent(uploaded.name, MsgType.Image, uploaded.mxcUrl, info);
      } else if (uploaded.msgtype === MsgType.Video) {
        await sendMessageContent(uploaded.name, MsgType.Video, uploaded.mxcUrl, info);
      } else if (uploaded.msgtype === MsgType.Audio) {
        await sendMessageContent(uploaded.name, MsgType.Audio, uploaded.mxcUrl, info);
      } else {
        await sendMessageContent(uploaded.name, MsgType.File, uploaded.mxcUrl, info);
      }

      return uploaded;
    },
    [client, uploadFile],
  );

  return { uploadFile, sendFileMessage };
}
