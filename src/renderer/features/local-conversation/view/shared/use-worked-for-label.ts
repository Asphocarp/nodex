import { useEffect, useState } from "react";
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

  useEffect(() => {
    if (timing?.status !== "working" || timing.completedAtMs !== null) return undefined;

    const intervalId = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [timing]);

  return resolveWorkedForLabelText({
    timing,
    durationMs,
    fallbackTimeLabel,
    nowMs,
  });
}
