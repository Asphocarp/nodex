import { useSyncExternalStore } from "react";
import type { CodexReviewDiffCommentAttachment } from "@/lib/types";

type Listener = () => void;

const attachmentsByThreadId = new Map<string, CodexReviewDiffCommentAttachment[]>();
const listeners = new Set<Listener>();
const EMPTY_ATTACHMENTS: CodexReviewDiffCommentAttachment[] = [];

function emitChange(): void {
  for (const listener of listeners) {
    listener();
  }
}

function getThreadKey(threadId: string | null | undefined): string | null {
  const normalized = threadId?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}

export function getReviewDiffCommentAttachmentsSnapshot(
  threadId: string | null | undefined,
): CodexReviewDiffCommentAttachment[] {
  const key = getThreadKey(threadId);
  if (!key) return EMPTY_ATTACHMENTS;
  return attachmentsByThreadId.get(key) ?? EMPTY_ATTACHMENTS;
}

export function subscribeReviewDiffCommentAttachments(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useReviewDiffCommentAttachments(
  threadId: string | null | undefined,
): CodexReviewDiffCommentAttachment[] {
  return useSyncExternalStore(
    subscribeReviewDiffCommentAttachments,
    () => getReviewDiffCommentAttachmentsSnapshot(threadId),
    () => EMPTY_ATTACHMENTS,
  );
}

export function addReviewDiffCommentAttachment(
  threadId: string | null | undefined,
  attachment: CodexReviewDiffCommentAttachment,
): void {
  const key = getThreadKey(threadId);
  if (!key) return;

  const current = attachmentsByThreadId.get(key) ?? [];
  const next = [...current.filter((candidate) => candidate.id !== attachment.id), attachment];
  attachmentsByThreadId.set(key, next);
  emitChange();
}

export function updateReviewDiffCommentAttachment(
  threadId: string | null | undefined,
  attachment: CodexReviewDiffCommentAttachment,
): void {
  const key = getThreadKey(threadId);
  if (!key) return;

  const current = attachmentsByThreadId.get(key) ?? [];
  if (!current.some((candidate) => candidate.id === attachment.id)) return;
  attachmentsByThreadId.set(
    key,
    current.map((candidate) => (candidate.id === attachment.id ? attachment : candidate)),
  );
  emitChange();
}

export function removeReviewDiffCommentAttachment(
  threadId: string | null | undefined,
  attachmentId: string,
): void {
  const key = getThreadKey(threadId);
  if (!key) return;

  const current = attachmentsByThreadId.get(key) ?? [];
  const next = current.filter((candidate) => candidate.id !== attachmentId);
  if (next.length === current.length) return;
  if (next.length === 0) {
    attachmentsByThreadId.delete(key);
  } else {
    attachmentsByThreadId.set(key, next);
  }
  emitChange();
}

export function clearReviewDiffCommentAttachments(threadId: string | null | undefined): void {
  const key = getThreadKey(threadId);
  if (!key || !attachmentsByThreadId.has(key)) return;
  attachmentsByThreadId.delete(key);
  emitChange();
}

export function __resetReviewDiffCommentAttachmentStoreForTests(): void {
  attachmentsByThreadId.clear();
  emitChange();
}
