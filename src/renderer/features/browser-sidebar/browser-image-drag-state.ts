import type {
  BrowserSidebarImageDragStateEvent,
  BrowserSidebarTabIdentity,
} from "../../../shared/browser-sidebar";

export interface BrowserImageDragIntent extends BrowserSidebarTabIdentity {
  attachmentConversationId: string;
}

const activeByAttachmentConversation = new Map<
  string,
  BrowserImageDragIntent
>();
const listeners = new Set<() => void>();
const EMPTY_DRAG: BrowserImageDragIntent | null = null;

function notify(): void {
  for (const listener of listeners) listener();
}

export function publishBrowserImageDragState(
  attachmentConversationId: string,
  event: BrowserSidebarImageDragStateEvent,
): void {
  if (!attachmentConversationId) return;
  const current = activeByAttachmentConversation.get(
    attachmentConversationId,
  );
  if (event.isActive) {
    activeByAttachmentConversation.set(attachmentConversationId, {
      attachmentConversationId,
      browserConversationId: event.browserConversationId,
      browserViewScopeId: event.browserViewScopeId,
      browserTabId: event.browserTabId,
    });
    notify();
    return;
  }
  if (
    !current
    || current.browserConversationId !== event.browserConversationId
    || current.browserViewScopeId !== event.browserViewScopeId
    || current.browserTabId !== event.browserTabId
  ) {
    return;
  }
  activeByAttachmentConversation.delete(attachmentConversationId);
  notify();
}

export function clearBrowserImageDragState(
  attachmentConversationId: string,
): void {
  if (!activeByAttachmentConversation.delete(attachmentConversationId)) return;
  notify();
}

export function getBrowserImageDragSnapshot(
  attachmentConversationId: string,
): BrowserImageDragIntent | null {
  return activeByAttachmentConversation.get(attachmentConversationId)
    ?? EMPTY_DRAG;
}

export function subscribeBrowserImageDragState(
  listener: () => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
