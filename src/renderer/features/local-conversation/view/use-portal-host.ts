import { useCallback, useSyncExternalStore } from "react";

interface PortalHostTarget {
  attribute: string;
  fallbackId: string;
  conversationId?: string | null;
}

function resolvePortalHost({
  attribute,
  fallbackId,
  conversationId,
}: PortalHostTarget): HTMLElement | null {
  if (typeof document === "undefined") return null;
  if (conversationId === null || conversationId === undefined) {
    return document.getElementById(fallbackId);
  }

  let hasAttributedHost = false;
  const candidates = document.querySelectorAll<HTMLElement>(`[${attribute}]`);
  for (const candidate of candidates) {
    hasAttributedHost = true;
    if (candidate.getAttribute("data-above-composer-conversation-id") === conversationId) {
      return candidate;
    }
  }

  if (hasAttributedHost) return null;
  return document.getElementById(fallbackId);
}

function subscribeToPortalHost(
  target: PortalHostTarget,
  onStoreChange: () => void,
): () => void {
  if (typeof document === "undefined") return () => {};

  let observer: MutationObserver | null = null;
  let retryTimer: number | null = null;
  const observeHost = (host: HTMLElement) => {
    if (observer !== null) return;
    observer = new MutationObserver(onStoreChange);
    observer.observe(host, { childList: true });
  };

  const host = resolvePortalHost(target);
  if (host !== null) {
    observeHost(host);
  } else {
    retryTimer = window.setTimeout(() => {
      const retryHost = resolvePortalHost(target);
      if (retryHost === null) return;
      observeHost(retryHost);
      onStoreChange();
    }, 0);
  }

  return () => {
    if (retryTimer !== null) {
      window.clearTimeout(retryTimer);
    }
    observer?.disconnect();
  };
}

function resolveServerPortalHost(): null {
  return null;
}

export function usePortalHost(target: PortalHostTarget): HTMLElement | null {
  const subscribe = useCallback(
    (onStoreChange: () => void) => subscribeToPortalHost(target, onStoreChange),
    [target.attribute, target.conversationId, target.fallbackId],
  );
  const getSnapshot = useCallback(
    () => resolvePortalHost(target),
    [target.attribute, target.conversationId, target.fallbackId],
  );

  return useSyncExternalStore(subscribe, getSnapshot, resolveServerPortalHost);
}
