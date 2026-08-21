import { useSyncExternalStore } from "react";
import {
  makeBrowserSidebarTabKey,
  type BrowserSidebarTabIdentity,
} from "../../../shared/browser-sidebar";

const documentBottomByTabId = new Map<string, boolean>();
const listenersByTabId = new Map<string, Set<() => void>>();

export function publishBrowserDocumentBottom(
  identity: BrowserSidebarTabIdentity,
  isAtDocumentBottom: boolean,
) {
  const key = makeBrowserSidebarTabKey(identity);
  if (documentBottomByTabId.get(key) === isAtDocumentBottom) return;
  documentBottomByTabId.set(key, isAtDocumentBottom);
  for (const listener of listenersByTabId.get(key) ?? []) {
    listener();
  }
}

export function clearBrowserDocumentBottom(identity: BrowserSidebarTabIdentity) {
  const key = makeBrowserSidebarTabKey(identity);
  publishBrowserDocumentBottom(identity, false);
  documentBottomByTabId.delete(key);
}

function subscribeBrowserDocumentBottom(browserTabId: string | null, listener: () => void) {
  if (!browserTabId) return () => {};

  const listeners = listenersByTabId.get(browserTabId) ?? new Set();
  listeners.add(listener);
  listenersByTabId.set(browserTabId, listeners);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) listenersByTabId.delete(browserTabId);
  };
}

function readBrowserDocumentBottom(browserTabId: string | null) {
  return browserTabId ? (documentBottomByTabId.get(browserTabId) ?? false) : false;
}

export function getBrowserDocumentBottomKey(identity: BrowserSidebarTabIdentity | null) {
  return identity ? makeBrowserSidebarTabKey(identity) : null;
}

export function useBrowserDocumentBottom(identity: BrowserSidebarTabIdentity | null) {
  const key = getBrowserDocumentBottomKey(identity);
  return useSyncExternalStore(
    (listener) => subscribeBrowserDocumentBottom(key, listener),
    () => readBrowserDocumentBottom(key),
    () => false,
  );
}
