import {
  useCallback,
  useEffect,
  useRef,
} from "react";
import type { WorkbenchLayoutSnapshot } from "../../shared/workbench-layout";
import { saveWindowSessionLayout } from "./window-sessions";

const WINDOW_SESSION_LAYOUT_SAVE_DEBOUNCE_MS = 350;

export function useWindowSessionLayoutPersistence(input: {
  readonly sessionId: string;
  readonly initialRevision: number;
  readonly initialLayout: WorkbenchLayoutSnapshot;
  readonly layout: WorkbenchLayoutSnapshot;
}) {
  const latestLayoutRef = useRef(input.initialLayout);
  const latestSerializedLayoutRef = useRef(
    JSON.stringify(input.initialLayout),
  );
  const layoutRevisionRef = useRef(input.initialRevision);
  const layoutSaveChainRef = useRef<Promise<void>>(Promise.resolve());
  const layoutSaveTimerRef = useRef<number | null>(null);

  useEffect(() => {
    latestLayoutRef.current = input.layout;
    const serialized = JSON.stringify(input.layout);
    if (serialized === latestSerializedLayoutRef.current) return;
    latestSerializedLayoutRef.current = serialized;
    layoutRevisionRef.current += 1;
  }, [input.layout]);

  const flush = useCallback(async () => {
    if (layoutSaveTimerRef.current !== null) {
      window.clearTimeout(layoutSaveTimerRef.current);
      layoutSaveTimerRef.current = null;
    }

    const saveInput = {
      sessionId: input.sessionId,
      revision: layoutRevisionRef.current,
      layout: latestLayoutRef.current,
    };
    const save = layoutSaveChainRef.current.then(async () => {
      const accepted = await saveWindowSessionLayout(saveInput);
      layoutRevisionRef.current = Math.max(
        layoutRevisionRef.current,
        accepted.session.layoutRevision,
      );
    });
    layoutSaveChainRef.current = save.catch(() => undefined);
    await save;
  }, [input.sessionId]);

  useEffect(() => {
    if (layoutSaveTimerRef.current !== null) {
      window.clearTimeout(layoutSaveTimerRef.current);
    }

    layoutSaveTimerRef.current = window.setTimeout(() => {
      layoutSaveTimerRef.current = null;
      void flush();
    }, WINDOW_SESSION_LAYOUT_SAVE_DEBOUNCE_MS);

    return () => {
      if (layoutSaveTimerRef.current === null) return;
      window.clearTimeout(layoutSaveTimerRef.current);
      layoutSaveTimerRef.current = null;
    };
  }, [flush, input.layout]);

  return {
    flush,
  };
}

export const windowSessionLayoutPersistenceTiming = {
  saveDebounceMs: WINDOW_SESSION_LAYOUT_SAVE_DEBOUNCE_MS,
};
