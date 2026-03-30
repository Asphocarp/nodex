export function installAsyncRequestAnimationFrame(): void {
  Object.defineProperty(globalThis, "requestAnimationFrame", {
    configurable: true,
    writable: true,
    value: ((callback: FrameRequestCallback) => {
      return setTimeout(() => callback(performance.now()), 0) as unknown as number;
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
  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    writable: true,
    value: class ResizeObserver {
      private readonly callback: ResizeObserverCallback;

      constructor(callback: ResizeObserverCallback) {
        this.callback = callback;
      }

      observe(target: Element) {
        this.callback([
          {
            target,
            contentRect: target.getBoundingClientRect(),
            borderBoxSize: [{ blockSize, inlineSize }],
            contentBoxSize: [{ blockSize, inlineSize }],
            devicePixelContentBoxSize: [{ blockSize, inlineSize }],
          } as unknown as ResizeObserverEntry,
        ], this);
      }

      disconnect() { }

      unobserve() { }
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
