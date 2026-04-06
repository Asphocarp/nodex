import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { installAsyncRequestAnimationFrame } from "../../../test/browser-globals";
import { render } from "../../../test/dom";
import {
  EnsureLocalConversationThreadScrollController,
  LocalConversationThreadScrollLayout,
} from "./local-conversation-thread-scroll-controller";

describe("LocalConversationThreadScrollLayout", () => {
  const originalResizeObserver = globalThis.ResizeObserver;

  beforeEach(() => {
    installAsyncRequestAnimationFrame();
  });

  afterEach(() => {
    if (typeof originalResizeObserver === "undefined") {
      Reflect.deleteProperty(
        globalThis as typeof globalThis & {
          ResizeObserver?: typeof ResizeObserver;
        },
        "ResizeObserver",
      );
      return;
    }
    Object.defineProperty(globalThis, "ResizeObserver", {
      configurable: true,
      value: originalResizeObserver,
      writable: true,
    });
  });

  test("does not attach a resize observer for viewport auto-stick", () => {
    let resizeObserverInstances = 0;

    class TestResizeObserver {
      constructor() {
        resizeObserverInstances += 1;
      }

      disconnect() {}

      observe() {}

      unobserve() {}
    }

    Object.defineProperty(globalThis, "ResizeObserver", {
      configurable: true,
      value: TestResizeObserver,
      writable: true,
    });

    render(
      <EnsureLocalConversationThreadScrollController>
        <LocalConversationThreadScrollLayout>
          <div>Thread content</div>
        </LocalConversationThreadScrollLayout>
      </EnsureLocalConversationThreadScrollController>,
    );

    expect(resizeObserverInstances).toBe(0);
  });
});
