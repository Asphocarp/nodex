import { useEffect, useRef, useState } from "react";

export function useTransientFeedback(durationMs = 1_500) {
  const [visible, setVisible] = useState(false);
  const resetTimerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (resetTimerRef.current !== null) window.clearTimeout(resetTimerRef.current);
    },
    [],
  );

  const show = () => {
    setVisible(true);
    if (resetTimerRef.current !== null) window.clearTimeout(resetTimerRef.current);
    resetTimerRef.current = window.setTimeout(() => {
      setVisible(false);
      resetTimerRef.current = null;
    }, durationMs);
  };

  return { visible, show };
}
