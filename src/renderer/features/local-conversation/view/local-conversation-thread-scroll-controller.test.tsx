import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act } from "@testing-library/react";
import { useEffect } from "react";
import { installAsyncRequestAnimationFrame } from "../../../test/browser-globals";
import { render, settleAsyncRender } from "../../../test/dom";
import {
  REMOTE_HOSTED_PIP_ANCHOR_HOST_ATTRIBUTE,
  REMOTE_HOSTED_PIP_MAIN_THREAD_HOST_ID,
  REMOTE_HOSTED_PIP_OBSTACLE_ATTRIBUTE,
  type CodexDesktopMessageFromView,
} from "../../../../shared/remote-hosted-pip";
import {
  EnsureLocalConversationThreadScrollController,
  LocalConversationThreadScrollLayout,
  useLocalConversationThreadScrollController,
  type LocalConversationThreadScrollControllerValue,
} from "./local-conversation-thread-scroll-controller";

function ControllerProbe({
  onController,
}: {
  onController: (controller: LocalConversationThreadScrollControllerValue) => void;
}) {
  const controller = useLocalConversationThreadScrollController();
  useEffect(() => {
    onController(controller);
  }, [controller, onController]);
  return null;
}

describe("LocalConversationThreadScrollLayout", () => {
  const originalResizeObserver = globalThis.ResizeObserver;
  const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
  const originalElectronBridge = window.electronBridge;

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
    } else {
      Object.defineProperty(globalThis, "ResizeObserver", {
        configurable: true,
        value: originalResizeObserver,
        writable: true,
      });
    }

    Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
      configurable: true,
      value: originalGetBoundingClientRect,
      writable: true,
    });

    if (typeof originalElectronBridge === "undefined") {
      Reflect.deleteProperty(window, "electronBridge");
      return;
    }

    Object.defineProperty(window, "electronBridge", {
      configurable: true,
      value: originalElectronBridge,
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

  test("renders the scroll container and shifts content by the provided offset", () => {
    const view = render(
      <EnsureLocalConversationThreadScrollController>
        <LocalConversationThreadScrollLayout contentX={-158}>
          <div>Thread content</div>
        </LocalConversationThreadScrollLayout>
      </EnsureLocalConversationThreadScrollController>,
    );

    const scrollContainer = view.container.querySelector("[data-local-conversation-thread-body='true']");
    const shiftedContent = scrollContainer?.firstElementChild as HTMLElement | null;
    const widthWrapper = shiftedContent?.querySelector("[data-mcp-app-portal-target='true']") as HTMLElement | null;

    expect(scrollContainer !== null).toBeTrue();
    expect(scrollContainer?.getAttribute(REMOTE_HOSTED_PIP_ANCHOR_HOST_ATTRIBUTE)).toBe(
      REMOTE_HOSTED_PIP_MAIN_THREAD_HOST_ID,
    );
    expect(widthWrapper !== null).toBeTrue();
    expect(shiftedContent?.style.transform.includes("translateX(-158px)")).toBeTrue();
  });

  test("measures sticky footer height into Codex scroll padding", () => {
    Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
      configurable: true,
      value(this: HTMLElement) {
        if (this.getAttribute("data-thread-scroll-footer") === "true") {
          return {
            bottom: 48,
            height: 48,
            left: 0,
            right: 300,
            top: 0,
            width: 300,
            x: 0,
            y: 0,
            toJSON: () => ({}),
          } as DOMRect;
        }
        return originalGetBoundingClientRect.call(this);
      },
    });

    class TestResizeObserver {
      private readonly callback: ResizeObserverCallback;

      constructor(callback: ResizeObserverCallback) {
        this.callback = callback;
      }

      disconnect() {}

      observe(target: Element) {
        this.callback([{ target } as ResizeObserverEntry], this as unknown as ResizeObserver);
      }

      unobserve() {}
    }

    Object.defineProperty(globalThis, "ResizeObserver", {
      configurable: true,
      value: TestResizeObserver,
      writable: true,
    });

    const view = render(
      <EnsureLocalConversationThreadScrollController>
        <LocalConversationThreadScrollLayout footer={<div>Composer</div>}>
          <div>Thread content</div>
        </LocalConversationThreadScrollLayout>
      </EnsureLocalConversationThreadScrollController>,
    );

    const scrollContainer = view.container.querySelector("[data-local-conversation-thread-body='true']") as HTMLElement | null;
    const footer = view.container.querySelector("[data-thread-scroll-footer='true']");
    const footerObstacle = view.container.querySelector(`[${REMOTE_HOSTED_PIP_OBSTACLE_ATTRIBUTE}='thread-footer']`);

    expect(Boolean(footer)).toBeTrue();
    expect(Boolean(footerObstacle)).toBeTrue();
    expect(scrollContainer?.style.getPropertyValue("--thread-scroll-padding-bottom")).toBe("64px");
  });

  test("publishes remote-hosted PiP host layout and clears it on unmount", async () => {
    const messages: CodexDesktopMessageFromView[] = [];

    Object.defineProperty(window, "electronBridge", {
      configurable: true,
      value: {
        sendMessageFromView: async (message: CodexDesktopMessageFromView) => {
          messages.push(message);
        },
        showContextMenu: async () => null,
      },
      writable: true,
    });

    Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
      configurable: true,
      value(this: HTMLElement) {
        if (this.getAttribute("data-local-conversation-thread-body") === "true") {
          return createDomRect({
            height: 800,
            width: 1_000,
            x: 100,
            y: 50,
          });
        }
        if (this.getAttribute(REMOTE_HOSTED_PIP_OBSTACLE_ATTRIBUTE) === "thread-footer") {
          return createDomRect({
            height: 120,
            width: 1_000,
            x: 100,
            y: 730,
          });
        }
        return originalGetBoundingClientRect.call(this);
      },
      writable: true,
    });

    const view = render(
      <EnsureLocalConversationThreadScrollController>
        <LocalConversationThreadScrollLayout footer={<div>Composer</div>}>
          <div>Thread content</div>
        </LocalConversationThreadScrollLayout>
      </EnsureLocalConversationThreadScrollController>,
    );

    await settleAsyncRender();

    const layoutMessage = messages.find((message) =>
      message.type === "remote-hosted-pip-host-layout-changed"
      && message.layout.anchorRect !== null
    );
    expect(layoutMessage !== undefined).toBeTrue();
    if (layoutMessage?.type !== "remote-hosted-pip-host-layout-changed") return;

    const bottomRight = layoutMessage.layout.anchors?.find((anchor) => anchor.alignment === "bottom-right");
    expect(layoutMessage.layout.hostId).toBe(REMOTE_HOSTED_PIP_MAIN_THREAD_HOST_ID);
    expect(bottomRight?.point.y ?? 0).toBe(718);

    await act(async () => {
      view.unmount();
      await Promise.resolve();
    });

    const lastMessage = messages[messages.length - 1];
    expect(lastMessage?.type ?? "").toBe("remote-hosted-pip-host-layout-changed");
    if (lastMessage?.type !== "remote-hosted-pip-host-layout-changed") return;

    expect(lastMessage.layout.anchorRect === null).toBeTrue();
    expect(lastMessage.layout.anchors === null).toBeTrue();
  });

  test("records pending latest-turn placement against response spacer height", async () => {
    let controller: LocalConversationThreadScrollControllerValue | null = null;
    const view = render(
      <EnsureLocalConversationThreadScrollController>
        <LocalConversationThreadScrollLayout>
          <ControllerProbe
            onController={(nextController) => {
              controller = nextController;
            }}
          />
          <div style={{ height: "1000px" }}>Thread content</div>
        </LocalConversationThreadScrollLayout>
      </EnsureLocalConversationThreadScrollController>,
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const scrollContainer = view.container.querySelector(
      "[data-local-conversation-thread-body='true']",
    ) as HTMLDivElement | null;
    expect(scrollContainer !== null).toBeTrue();
    if (!scrollContainer || controller === null) return;

    Object.defineProperty(scrollContainer, "scrollHeight", {
      configurable: true,
      value: 1000,
    });
    Object.defineProperty(scrollContainer, "clientHeight", {
      configurable: true,
      value: 500,
    });
    let scrollTopValue = -280;
    Object.defineProperty(scrollContainer, "scrollTop", {
      configurable: true,
      get: () => scrollTopValue,
      set: (value: number) => {
        scrollTopValue = value;
      },
    });

    await act(async () => {
      controller?.registerResponseSpacerState({
        getHeightPx: () => 100,
        scrollToBottom: () => {},
      });
      await Promise.resolve();
    });

    const placement = controller.prepareLatestTurnSubmitPlacement();
    expect(placement?.distanceFromBottomPx ?? 0).toBe(280);
    expect(placement?.scrollHeightPx ?? 0).toBe(1000);
    expect(placement?.shouldPlaceLatestTurn ?? false).toBeTrue();
    expect(controller.consumePendingLatestTurnSubmitPlacement()?.distanceFromBottomPx ?? 0).toBe(280);
    expect(controller.consumePendingLatestTurnSubmitPlacement() === null).toBeTrue();
  });
});

function createDomRect({
  height,
  width,
  x,
  y,
}: {
  height: number;
  width: number;
  x: number;
  y: number;
}): DOMRect {
  return {
    bottom: y + height,
    height,
    left: x,
    right: x + width,
    top: y,
    width,
    x,
    y,
    toJSON: () => ({}),
  } as DOMRect;
}
