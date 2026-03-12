const ALLOWED_TAGS = new Set(["STRONG", "B", "EM", "I", "S", "DEL", "CODE", "BR", "DIV", "P"]);

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function sanitizeNodeToHtml(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return escapeHtml(node.textContent ?? "");
  }

  if (!(node instanceof HTMLElement)) {
    return "";
  }

  const tagName = node.tagName.toUpperCase();

  if (!ALLOWED_TAGS.has(tagName)) {
    return Array.from(node.childNodes).map(sanitizeNodeToHtml).join("");
  }

  if (tagName === "BR") {
    return "<br />";
  }

  const children = Array.from(node.childNodes).map(sanitizeNodeToHtml).join("");

  if (tagName === "DIV" || tagName === "P") {
    return children ? `${children}<br />` : "<br />";
  }

  if (tagName === "B") {
    return `<strong>${children}</strong>`;
  }

  if (tagName === "I") {
    return `<em>${children}</em>`;
  }

  if (tagName === "DEL") {
    return `<s>${children}</s>`;
  }

  const normalizedTag = tagName.toLowerCase();
  return `<${normalizedTag}>${children}</${normalizedTag}>`;
}

function nodeToPlainText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent ?? "";
  }

  if (!(node instanceof HTMLElement)) {
    return "";
  }

  const tagName = node.tagName.toUpperCase();
  if (tagName === "BR") {
    return "\n";
  }

  const children = Array.from(node.childNodes).map(nodeToPlainText).join("");
  if (tagName === "DIV" || tagName === "P") {
    return `${children}\n`;
  }

  return children;
}

function getWrapperDocument(html: string): HTMLDivElement | null {
  if (typeof document === "undefined") return null;
  const wrapper = document.createElement("div");
  wrapper.innerHTML = html;
  return wrapper;
}

function trimTrailingBreaks(html: string): string {
  return html.replace(/(?:<br \/>)+$/g, "");
}

export function sanitizeFormattedHtml(html: string): string {
  const wrapper = getWrapperDocument(html);
  if (!wrapper) {
    return escapeHtml(html).replace(/\n/g, "<br />");
  }

  return trimTrailingBreaks(Array.from(wrapper.childNodes).map(sanitizeNodeToHtml).join(""));
}

export function normalizeComposerHtml(html: string): string {
  const safe = sanitizeFormattedHtml(html)
    .replace(/<(strong|em|s|code)><\/\1>/g, "")
    .replace(/(?:<br \/>){3,}/g, "<br /><br />")
    .trim();

  return safe;
}

export function formattedHtmlToPlainText(html: string): string {
  const wrapper = getWrapperDocument(html);
  if (!wrapper) {
    return html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .trim();
  }

  return Array.from(wrapper.childNodes)
    .map(nodeToPlainText)
    .join("")
    .replace(/\u00a0/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function isComposerHtmlEmpty(html: string): boolean {
  return formattedHtmlToPlainText(html).trim().length === 0;
}

export function formatMessageTextToHtml(text: string): string {
  const codeTokens: string[] = [];
  let html = escapeHtml(text);

  html = html.replace(/`([^`]+)`/g, (_match, code: string) => {
    const token = `@@CODE_${codeTokens.length}@@`;
    codeTokens.push(`<code>${code}</code>`);
    return token;
  });

  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/_([^_]+)_/g, "<em>$1</em>");
  html = html.replace(/~~([^~]+)~~/g, "<s>$1</s>");

  codeTokens.forEach((replacement, index) => {
    html = html.replace(`@@CODE_${index}@@`, replacement);
  });

  return html.replace(/\n/g, "<br />");
}

export function stripFormattingMarkers(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1")
    .replace(/`([^`]+)`/g, "$1");
}
