import { afterEach, describe, expect, test, vi } from "vitest";
import type { BrowserUseCursorState } from "../../../shared/browser-sidebar";
import {
  clampBrowserAgentCursorPoint,
  createBrowserAgentCursorController,
} from "./browser-agent-cursor";

afterEach(() => {
  document.body.innerHTML = "";
});

function makeCursor(
  overrides: Partial<BrowserUseCursorState> = {},
): BrowserUseCursorState {
  return {
    browserConversationId: "conversation-1",
    browserViewScopeId: "window-1",
    browserTabId: "browser-use:1",
    moveSequence: 1,
    visible: true,
    updatedAt: 1,
    x: 100,
    y: 50,
    ...overrides,
  };
}

describe("browser agent cursor", () => {
  test("uses the target-relative default point and clamps reported coordinates", () => {
    expect(clampBrowserAgentCursorPoint({
      viewportHeight: 800,
      viewportWidth: 1_000,
    })).toEqual({ x: 580, y: 440 });
    expect(clampBrowserAgentCursorPoint({
      cursorX: 1_500,
      cursorY: -100,
      viewportHeight: 800,
      viewportWidth: 1_000,
    })).toEqual({ x: 1_000, y: 0 });
  });

  test("renders the glowing cursor asset and acknowledges a non-animated move immediately", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const onArrived = vi.fn();
    const controller = createBrowserAgentCursorController(host, { onArrived });

    controller.setState({
      cursor: makeCursor({ animateMovement: false, moveSequence: 7 }),
      isVisible: true,
      turnKey: "conversation-1:active",
      viewportSize: { height: 800, width: 1_000 },
    });

    const cursor = host.querySelector<HTMLElement>(
      "[data-testid='browser-agent-cursor']",
    );
    const asset = host.querySelector<HTMLImageElement>(
      "[data-browser-agent-cursor-asset]",
    );
    expect(cursor?.style.transform).toContain("translate3d(88px, 38px, 0)");
    expect(asset?.src.startsWith("data:image/png;base64,")).toBe(true);
    expect(asset?.width).toBe(23);
    expect(asset?.height).toBe(24);
    expect(asset?.style.filter).toContain("drop-shadow");
    expect(onArrived).toHaveBeenCalledOnce();
    expect(onArrived).toHaveBeenCalledWith(7);

    controller.destroy();
    expect(host.childElementCount).toBe(0);
  });

  test("shows the idle cursor at its default point without fabricating an arrival", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const onArrived = vi.fn();
    const controller = createBrowserAgentCursorController(host, { onArrived });

    controller.setState({
      cursor: null,
      isVisible: true,
      turnKey: "conversation-1:active",
      viewportSize: { height: 800, width: 1_000 },
    });

    expect(
      host.querySelector<HTMLElement>("[data-testid='browser-agent-cursor']")
        ?.style.transform,
    ).toContain("translate3d(568px, 428px, 0)");
    expect(onArrived).not.toHaveBeenCalled();
    controller.destroy();
  });

  test("does not acknowledge an animated move before the visual motion finishes", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const onArrived = vi.fn();
    const controller = createBrowserAgentCursorController(host, { onArrived });
    controller.setState({
      cursor: makeCursor({
        animateMovement: false,
        moveSequence: 1,
        x: 10,
        y: 10,
      }),
      isVisible: true,
      turnKey: "conversation-1:active",
      viewportSize: { height: 800, width: 1_000 },
    });
    onArrived.mockClear();

    controller.setState({
      cursor: makeCursor({
        animateMovement: true,
        moveSequence: 2,
        x: 100,
        y: 100,
      }),
      isVisible: true,
      turnKey: "conversation-1:active",
      viewportSize: { height: 800, width: 1_000 },
    });

    expect(onArrived).not.toHaveBeenCalled();
    controller.destroy();
  });
});
