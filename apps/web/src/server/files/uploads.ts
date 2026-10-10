import { randomBytes } from "node:crypto";
import { MAX_ATTACHMENTS, safeFileName, type Attachment } from "@understudy/protocol";

export const UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;

export type Upload = {
  id: string;
  agentId: string;
  userId: string;
  name: string;
  size: number;
  createdAt: number;
  attachment?: Attachment;
};

export function newUploadId() {
  return `up_${randomBytes(18).toString("base64url")}`;
}

export class Uploads {
  private items = new Map<string, Upload>();

  constructor(private now: () => number = Date.now) {}

  create(agentId: string, userId: string, name: string, size: number): Upload {
    this.expire();
    const upload: Upload = { id: newUploadId(), agentId, userId, name: safeFileName(name), size, createdAt: this.now() };
    this.items.set(upload.id, upload);
    return upload;
  }

  get(id: string, agentId: string, userId: string): Upload | null {
    const upload = this.items.get(id);
    if (!upload || upload.agentId !== agentId || upload.userId !== userId) return null;
    if (this.now() - upload.createdAt > UPLOAD_TTL_MS) {
      this.items.delete(id);
      return null;
    }
    return upload;
  }

  finish(id: string, attachment: Attachment) {
    const upload = this.items.get(id);
    if (upload) upload.attachment = attachment;
  }

  remove(id: string) {
    this.items.delete(id);
  }

  claim(agentId: string, userId: string, ids: unknown): Attachment[] {
    if (!Array.isArray(ids)) return [];
    const attachments: Attachment[] = [];
    for (const id of [...new Set(ids)].slice(0, MAX_ATTACHMENTS)) {
      if (typeof id !== "string") continue;
      const upload = this.get(id, agentId, userId);
      if (!upload?.attachment) continue;
      attachments.push(upload.attachment);
      this.items.delete(id);
    }
    return attachments;
  }

  expire() {
    const cutoff = this.now() - UPLOAD_TTL_MS;
    for (const [id, upload] of this.items) if (upload.createdAt < cutoff) this.items.delete(id);
  }
}
