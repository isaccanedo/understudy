import { escapeSlack } from "./slack";

const LINK = /<(https?:\/\/[^\s<>|]+)(?:\|([^<>]*))?>/g;
const SLOT = /\u0000(\d+)\u0000/g;
const PREVIEW_LIMIT = 2800;

function hostOf(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

function link(url: string, label: string | undefined) {
  const text = label?.trim();
  if (!text) return `<${url}>`;
  const host = hostOf(url);
  return `<${url}|${escapeSlack(text)}>${host && !text.toLowerCase().includes(host.toLowerCase()) ? ` (${host})` : ""}`;
}

export function slackPreview(text: string) {
  const links: string[] = [];
  const marked = text.replace(/\u0000/g, "").replace(LINK, (_, url: string, label?: string) => `\u0000${links.push(link(url, label)) - 1}\u0000`);
  return escapeSlack(marked).replace(SLOT, (_, index: string) => links[Number(index)]);
}

export function clipPreview(text: string, limit = PREVIEW_LIMIT) {
  if (text.length <= limit) return { text, clipped: false };
  const cut = text.slice(0, limit);
  const open = cut.lastIndexOf("<");
  return { text: open > cut.lastIndexOf(">") ? cut.slice(0, open) : cut, clipped: true };
}
