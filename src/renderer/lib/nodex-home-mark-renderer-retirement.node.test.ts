import { describe, expect, test, vi } from "vite-plus/test";
import { retireNodexHomeMarkRendererAfterPaint } from "./nodex-home-mark-renderer-retirement";

describe("Nodex home mark renderer retirement", () => {
  test("keeps the renderer alive until the ownership handoff has painted", () => {
    const cancelFrame = vi.fn();
    const dispose = vi.fn();
    const onDisposed = vi.fn();
    const paintCallbacks: FrameRequestCallback[] = [];

    retireNodexHomeMarkRendererAfterPaint({
      cancelFrame,
      onDisposed,
      renderer: { dispose },
      requestFrame: (callback) => {
        paintCallbacks.push(callback);
        return 17;
      },
    });

    expect(dispose).not.toHaveBeenCalled();
    paintCallbacks[0]?.(16);
    expect(dispose).toHaveBeenCalledOnce();
    expect(onDisposed).toHaveBeenCalledOnce();
    expect(cancelFrame).not.toHaveBeenCalled();
  });

  test("retires immediately and at most once during component cleanup", () => {
    const cancelFrame = vi.fn();
    const dispose = vi.fn();
    const paintCallbacks: FrameRequestCallback[] = [];
    const disposeNow = retireNodexHomeMarkRendererAfterPaint({
      cancelFrame,
      renderer: { dispose },
      requestFrame: (callback) => {
        paintCallbacks.push(callback);
        return 23;
      },
    });

    disposeNow();
    paintCallbacks[0]?.(16);

    expect(cancelFrame).toHaveBeenCalledWith(23);
    expect(dispose).toHaveBeenCalledOnce();
  });
});
