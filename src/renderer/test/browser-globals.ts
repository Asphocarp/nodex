export function installAsyncRequestAnimationFrame(frameDelayMs = 0): void {
  Object.defineProperty(globalThis, "requestAnimationFrame", {
    configurable: true,
    writable: true,
    value: ((callback: FrameRequestCallback) => {
      return setTimeout(
        () => callback(performance.now()),
        frameDelayMs,
      ) as unknown as number;
    }) as typeof globalThis.requestAnimationFrame,
  });

  Object.defineProperty(globalThis, "cancelAnimationFrame", {
    configurable: true,
    writable: true,
    value: ((handle: number) => {
      clearTimeout(handle);
    }) as typeof globalThis.cancelAnimationFrame,
  });
}

export function installMeasuredResizeObserver({
  blockSize,
  inlineSize,
}: {
  blockSize: number;
  inlineSize: number;
}): void {
  const scheduleFrame = typeof requestAnimationFrame === "function"
    ? requestAnimationFrame
    : ((callback: FrameRequestCallback) =>
      setTimeout(() => callback(performance.now()), 0) as unknown as number);
  const cancelFrame = typeof cancelAnimationFrame === "function"
    ? cancelAnimationFrame
    : ((handle: number) => {
      clearTimeout(handle as unknown as ReturnType<typeof setTimeout>);
    });

  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    writable: true,
    value: class ResizeObserver {
      private readonly callback: ResizeObserverCallback;
      private readonly observedTargets = new Set<Element>();
      private pendingFrame: number | null = null;

      constructor(callback: ResizeObserverCallback) {
        this.callback = callback;
      }

      observe(target: Element) {
        if (!(target instanceof Element)) {
          throw new TypeError("ResizeObserver.observe target must be an Element");
        }
        this.observedTargets.add(target);
        this.scheduleDelivery();
      }

      disconnect() {
        this.observedTargets.clear();
        if (this.pendingFrame === null) return;
        cancelFrame(this.pendingFrame);
        this.pendingFrame = null;
      }

      unobserve(target: Element) {
        this.observedTargets.delete(target);
      }

      private scheduleDelivery() {
        if (this.pendingFrame !== null) return;
        this.pendingFrame = scheduleFrame(() => {
          this.pendingFrame = null;
          const entries = Array.from(this.observedTargets)
            .filter((target) => target.isConnected)
            .map((target) => ({
              target,
              contentRect: target.getBoundingClientRect(),
              borderBoxSize: [{ blockSize, inlineSize }],
              contentBoxSize: [{ blockSize, inlineSize }],
              devicePixelContentBoxSize: [{ blockSize, inlineSize }],
            }) as unknown as ResizeObserverEntry);
          if (entries.length === 0) return;
          this.callback(entries, this);
        });
      }
    } as typeof ResizeObserver,
  });
}

export function installElementScrollHeight(scrollHeight: number): void {
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
    configurable: true,
    get() {
      return scrollHeight;
    },
  });
}

export function installWindowApi(api: unknown): void {
  Object.defineProperty(window, "api", {
    configurable: true,
    writable: true,
    value: api,
  });
}
