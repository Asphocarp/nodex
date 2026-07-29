export interface BrowserImageAttachmentIntent {
  id: string;
  filename: string;
  path: string;
  dataUrl: string;
}

const pendingByConversation = new Map<
  string,
  readonly BrowserImageAttachmentIntent[]
>();
const listeners = new Set<() => void>();
const EMPTY_ATTACHMENTS: readonly BrowserImageAttachmentIntent[] =
  Object.freeze([]);
const MAX_PENDING_BROWSER_IMAGES = 16;

function notify(): void {
  for (const listener of listeners) listener();
}

export function publishBrowserImageAttachment(
  conversationId: string,
  attachment: BrowserImageAttachmentIntent,
): void {
  if (
    !conversationId
    || !attachment.id
    || !attachment.filename
    || !attachment.path
    || !attachment.dataUrl
  ) {
    throw new Error("Browser image attachment is incomplete");
  }
  const current = pendingByConversation.get(conversationId) ?? [];
  pendingByConversation.set(
    conversationId,
    [
      ...current.filter((candidate) => candidate.id !== attachment.id),
      Object.freeze({ ...attachment }),
    ].slice(-MAX_PENDING_BROWSER_IMAGES),
  );
  notify();
}

export function consumeBrowserImageAttachments(
  conversationId: string,
  attachmentIds: readonly string[],
): void {
  const current = pendingByConversation.get(conversationId) ?? [];
  const consumedIds = new Set(attachmentIds);
  const next = current.filter((attachment) => !consumedIds.has(attachment.id));
  if (next.length === current.length) return;
  if (next.length === 0) pendingByConversation.delete(conversationId);
  else pendingByConversation.set(conversationId, next);
  notify();
}

export function getBrowserImageAttachmentsSnapshot(
  conversationId: string,
): readonly BrowserImageAttachmentIntent[] {
  return pendingByConversation.get(conversationId) ?? EMPTY_ATTACHMENTS;
}

export function subscribeBrowserImageAttachments(
  listener: () => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
