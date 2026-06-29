import { lazy, Suspense, useEffect, useState } from "react";
import type { ThreadUserMessageNavigationItem } from "../thread-stage-types";
import {
  MIN_THREAD_USER_MESSAGE_NAVIGATION_ITEMS,
} from "../projection/thread-user-message-navigation-items";
import type {
  ThreadUserMessageNavigationRailProps,
} from "./thread-user-message-navigation-rail";

export const CODEX_USER_MESSAGE_NAVIGATION_FEATURE_FLAG_ID = 2551582477;

const LazyThreadUserMessageNavigationRail = lazy(() =>
  import("./thread-user-message-navigation-rail").then((module) => ({
    default: module.ThreadUserMessageNavigationRail,
  })),
);

export function ThreadUserMessageNavigationRailLazy({
  items,
  onRevealItem,
}: {
  items: ThreadUserMessageNavigationItem[];
  onRevealItem?: ThreadUserMessageNavigationRailProps["onRevealItem"];
}) {
  const [idleReady, setIdleReady] = useState(false);

  useEffect(() => {
    if (items.length < MIN_THREAD_USER_MESSAGE_NAVIGATION_ITEMS) {
      setIdleReady(false);
      return undefined;
    }

    let cancelled = false;
    const markReady = () => {
      if (cancelled) return;
      setIdleReady(true);
    };

    if (typeof window.requestIdleCallback === "function") {
      const handle = window.requestIdleCallback(markReady, { timeout: 2000 });
      return () => {
        cancelled = true;
        window.cancelIdleCallback(handle);
      };
    }

    const timeout = window.setTimeout(markReady, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [items.length]);

  if (items.length < MIN_THREAD_USER_MESSAGE_NAVIGATION_ITEMS) return null;
  if (!idleReady) return null;

  return (
    <Suspense fallback={null}>
      <LazyThreadUserMessageNavigationRail
        items={items}
        onRevealItem={onRevealItem}
      />
    </Suspense>
  );
}
