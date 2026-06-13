import { useEffect, useEffectEvent, useState } from "react";
import {
  resolveWorkedForLabelText,
  type ThreadWorkedForTiming,
} from "../../thread-worked-for-time";

export function useWorkedForLabelText({
  timing,
  durationMs,
  fallbackTimeLabel = null,
}: {
  timing: ThreadWorkedForTiming | null;
  durationMs: number | null;
  fallbackTimeLabel?: string | null;
}): string | null {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const isWorking = timing?.status === "working" && timing.completedAtMs === null;
  const tick = useEffectEvent(() => {
    setNowMs(Date.now());
  });

  useEffect(() => {
    if (!isWorking) return undefined;

    tick();
    const intervalId = window.setInterval(() => {
      tick();
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [isWorking]);

  return resolveWorkedForLabelText({
    timing,
    durationMs,
    fallbackTimeLabel,
    nowMs,
  });
}
