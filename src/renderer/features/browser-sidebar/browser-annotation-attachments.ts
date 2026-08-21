import {
  BrowserAnnotationAttachmentSchema,
  type BrowserAnnotationAttachment,
} from "../../../shared/browser-annotation";

export type { BrowserAnnotationAttachment } from "../../../shared/browser-annotation";

const attachmentsByConversation = new Map<string, BrowserAnnotationAttachment[]>();
const listeners = new Set<() => void>();
const EMPTY_ATTACHMENTS: readonly BrowserAnnotationAttachment[] = Object.freeze([]);
const MAX_BROWSER_ANNOTATION_ATTACHMENTS = 32;

function notify(): void {
  for (const listener of listeners) listener();
}

export function publishBrowserAnnotationAttachment(
  conversationId: string,
  attachment: BrowserAnnotationAttachment,
): void {
  const parsed = BrowserAnnotationAttachmentSchema.parse(attachment);
  attachmentsByConversation.set(
    conversationId,
    [...(attachmentsByConversation.get(conversationId) ?? []), parsed].slice(
      -MAX_BROWSER_ANNOTATION_ATTACHMENTS,
    ),
  );
  notify();
}

export function removeBrowserAnnotationAttachment(
  conversationId: string,
  attachmentId: string,
): void {
  const current = attachmentsByConversation.get(conversationId) ?? [];
  const next = current.filter((attachment) => attachment.id !== attachmentId);
  if (next.length === current.length) return;
  if (next.length === 0) attachmentsByConversation.delete(conversationId);
  else attachmentsByConversation.set(conversationId, next);
  notify();
}

export function clearBrowserAnnotationAttachments(conversationId: string): void {
  if (!attachmentsByConversation.delete(conversationId)) return;
  notify();
}

export function replaceBrowserAnnotationAttachments(
  conversationId: string,
  attachments: readonly BrowserAnnotationAttachment[],
): void {
  if (attachments.length === 0) {
    clearBrowserAnnotationAttachments(conversationId);
    return;
  }
  attachmentsByConversation.set(
    conversationId,
    attachments
      .map((attachment) => BrowserAnnotationAttachmentSchema.parse(attachment))
      .slice(-MAX_BROWSER_ANNOTATION_ATTACHMENTS),
  );
  notify();
}

export function getBrowserAnnotationAttachmentsSnapshot(
  conversationId: string,
): readonly BrowserAnnotationAttachment[] {
  return attachmentsByConversation.get(conversationId) ?? EMPTY_ATTACHMENTS;
}

export function subscribeBrowserAnnotationAttachments(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
