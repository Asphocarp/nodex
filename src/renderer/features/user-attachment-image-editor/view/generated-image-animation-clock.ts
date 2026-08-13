export interface GeneratedImageAnimationClock {
  subscribe(listener: (nowMs: number) => void): () => void;
  now(): number;
}

export interface GeneratedImageAnimationClockRuntime {
  cancelFrame(frameId: number): void;
  now(): number;
  requestFrame(callback: (nowMs: number) => void): number;
}

export interface GeneratedImageAnimationClockController
extends GeneratedImageAnimationClock {
  getSubscriberCount(): number;
}

export function createGeneratedImageAnimationClock(
  runtime: GeneratedImageAnimationClockRuntime,
): GeneratedImageAnimationClockController {
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

const sharedClock = createGeneratedImageAnimationClock({
  cancelFrame: (frameId) => cancelAnimationFrame(frameId),
  now: () => performance.now(),
  requestFrame: (callback) => requestAnimationFrame(callback),
});

export function getGeneratedImageAnimationClock(): GeneratedImageAnimationClock {
  return sharedClock;
}

export function getGeneratedImageAnimationClockSubscriberCount(): number {
  return sharedClock.getSubscriberCount();
}
