import { useEffect, useSyncExternalStore } from "react";
import {
  DictationSessionController,
  type DictationSessionSnapshot,
} from "./dictation-session-controller";

export const useDictationSession = (
  controller: DictationSessionController,
): DictationSessionSnapshot => {
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );

  useEffect(() => () => controller.dispose(), [controller]);
  return snapshot;
};
