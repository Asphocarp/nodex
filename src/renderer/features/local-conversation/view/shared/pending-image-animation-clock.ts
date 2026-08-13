export interface PendingImageAnimationClock {
  subscribe(listener: (nowMs: number) => void): () => void;
  now(): number;
}

export interface PendingImageAnimationClockRuntime {
  cancelFrame(frameId: number): void;
  now(): number;
  requestFrame(callback: (nowMs: number) => void): number;
}

export interface PendingImageAnimationClockController
extends PendingImageAnimationClock {
  getSubscriberCount(): number;
}

export function createPendingImageAnimationClock(
  runtime: PendingImageAnimationClockRuntime,
): PendingImageAnimationClockController {
  const listeners = new Set<(nowMs: number) => void>();
  let frameId: number | null = null;
  let lastNowMs = Number.NEGATIVE_INFINITY;

  const readNow = (candidate = runtime.now()) => {
    lastNowMs = Math.max(lastNowMs, candidate);
    return lastNowMs;
  };
  const schedule = () => {
    if (frameId !== null || listeners.size === 0) return;
    frameId = runtime.requestFrame(tick);
  };
  const tick = (timestamp: number) => {
    frameId = null;
    const nowMs = readNow(timestamp);
    for (const listener of [...listeners]) listener(nowMs);
    schedule();
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      schedule();
      return () => {
        listeners.delete(listener);
        if (listeners.size !== 0 || frameId === null) return;
        runtime.cancelFrame(frameId);
        frameId = null;
      };
    },
    now: readNow,
    getSubscriberCount: () => listeners.size,
  };
}

const sharedPendingImageAnimationClock = createPendingImageAnimationClock({
  cancelFrame: (frameId) => cancelAnimationFrame(frameId),
  now: () => performance.now(),
  requestFrame: (callback) => requestAnimationFrame(callback),
});

export function getPendingImageAnimationClock(): PendingImageAnimationClock {
  return sharedPendingImageAnimationClock;
}

export function getPendingImageAnimationClockSubscriberCount(): number {
  return sharedPendingImageAnimationClock.getSubscriberCount();
}
