import PostalMime from "postal-mime";

export type ParsedAttachment = { filename: string; mimeType: string; base64: string; bytes: number };

export type ParsedEmail = {
  from: string | null;
  fromName: string | null;
  to: string[];
  subject: string;
  date: string | null;
  text: string;
  attachments: ParsedAttachment[];
};

export const MAX_TEXT_CHARS = 20000;
export const MAX_ATTACHMENTS = 10;

function mailbox(address: unknown) {
  if (!address || typeof address !== "object") return null;
  const value = address as { address?: string; name?: string };
  return value.address ? { address: value.address.trim().toLowerCase(), name: value.name?.trim() || null } : null;
}

export function safeFilename(name: string | null | undefined, index: number) {
  const cleaned = (name ?? "")
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, "_")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 120);
  return cleaned || `attachment-${index + 1}`;
}

function htmlToText(html: string) {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function parseEmail(raw: Buffer | Uint8Array, maxAttachmentBytes: number): Promise<ParsedEmail> {
  const email = await PostalMime.parse(raw, { attachmentEncoding: "base64", maxNestingDepth: 20 });
  const from = mailbox(email.from);
  const to = (email.to ?? []).map(mailbox).filter((entry): entry is { address: string; name: string | null } => Boolean(entry)).map((entry) => entry.address);
  const body = email.text?.trim() || (email.html ? htmlToText(email.html) : "");
  const attachments: ParsedAttachment[] = [];
  for (const [index, attachment] of email.attachments.entries()) {
    if (attachments.length >= MAX_ATTACHMENTS) break;
    if (attachment.disposition === "inline" && !attachment.filename) continue;
    const base64 = typeof attachment.content === "string" ? attachment.content : Buffer.from(attachment.content as ArrayBuffer).toString("base64");
    const bytes = Math.floor((base64.length * 3) / 4);
    if (bytes > maxAttachmentBytes) continue;
    attachments.push({ filename: safeFilename(attachment.filename, index), mimeType: attachment.mimeType, base64, bytes });
  }
  return {
    from: from?.address ?? null,
    fromName: from?.name ?? null,
    to,
    subject: (email.subject ?? "").slice(0, 500),
    date: email.date ?? null,
    text: body.slice(0, MAX_TEXT_CHARS),
    attachments,
  };
}
