import { MsgType } from "matrix-js-sdk";

export type MatrixReplyTarget = {
  eventId: string;
  sender: string;
  text: string;
  msgtype?: string;
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function toQuotedLines(value: string): string {
  return value
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

export function stripMatrixReplyFallback(body: string): string {
  const lines = body.split("\n");
  let index = 0;

  while (index < lines.length && lines[index].startsWith(">")) {
    index += 1;
  }

  if (index > 0 && index < lines.length && lines[index].trim() === "") {
    return lines.slice(index + 1).join("\n").trimStart();
  }

  return body;
}

function toReplyPreviewText(target: MatrixReplyTarget): string {
  const stripped = stripMatrixReplyFallback(target.text).trim();
  if (stripped) return stripped;

  if (target.msgtype === MsgType.Image) return "Photo";
  if (target.msgtype === MsgType.Video) return "Video";
  if (target.msgtype === MsgType.Audio) return "Audio";
  if (target.msgtype === MsgType.File) return "File";
  return "Message";
}

export function buildReplyMessageContent(
  body: string,
  target: MatrixReplyTarget,
  msgtype: MsgType | string = MsgType.Text,
  extra: Record<string, unknown> = {},
) {
  const targetText = toReplyPreviewText(target);
  const safeTargetText = escapeHtml(targetText).replaceAll("\n", "<br />");
  const safeBody = escapeHtml(body).replaceAll("\n", "<br />");

  return {
    msgtype,
    body: `${toQuotedLines(`<${target.sender}> ${targetText}`)}\n\n${body}`,
    format: "org.matrix.custom.html",
    formatted_body:
      `<mx-reply><blockquote>` +
      `<a href="https://matrix.to/#/${target.eventId}">In reply to</a> ` +
      `<a href="https://matrix.to/#/${target.sender}">${escapeHtml(target.sender)}</a><br />` +
      `${safeTargetText}</blockquote></mx-reply>${safeBody}`,
    "m.relates_to": {
      "m.in_reply_to": {
        event_id: target.eventId,
      },
    },
    ...extra,
  };
}
