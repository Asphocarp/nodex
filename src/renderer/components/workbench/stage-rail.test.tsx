import { beforeEach, describe, expect, test } from "bun:test";
import { createElement } from "react";
import { StageRail, type StageRailStage } from "./stage-rail";
import { render, textContent } from "../../test/dom";

function createDomRect(width: number): DOMRect {
  return {
    x: 0,
    y: 0,
    width,
    height: 0,
    top: 0,
    left: 0,
    right: width,
    bottom: 0,
    toJSON() {
      return this;
    },
  } as DOMRect;
}

function SquareIcon({ className }: { className?: string }) {
  return createElement("span", { className }, "I");
}

const STAGES: StageRailStage[] = [
  {
    id: "db",
    title: "Views",
    icon: SquareIcon,
    content: createElement("div", undefined, "views"),
  },
  {
    id: "cards",
    title: "Cards",
    icon: SquareIcon,
    content: createElement("div", undefined, "cards"),
  },
  {
    id: "threads",
    title: "Threads",
    icon: SquareIcon,
    content: createElement("div", undefined, "threads"),
  },
  {
    id: "files",
    title: "Diffs",
    icon: SquareIcon,
    content: createElement("div", undefined, "diff"),
  },
];

describe("StageRail", () => {
  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
      configurable: true,
      writable: true,
      value: function getBoundingClientRect() {
        const width = this.parentElement?.getAttribute("data-layout-mode") === "sliding-window"
          ? 1200
          : 0;
        return createDomRect(width);
      },
    });
  });

  test("renders collapsed stages as icon buttons", () => {
    const { container, getByLabelText } = render(
      <StageRail
        stages={STAGES}
        focusedStage="cards"
        collapsedStages={{
          cards: true,
          threads: true,
        }}
        onFocusStage={() => undefined}
        onSetStageCollapsed={() => undefined}
      />,
    );

    expect(getByLabelText("Expand Cards").getAttribute("aria-label")).toBe("Expand Cards");
    expect(getByLabelText("Expand Threads").getAttribute("aria-label")).toBe("Expand Threads");
    expect(container.querySelectorAll('[data-stage-collapsed="true"]').length).toBe(2);
  });

  test("stacks adjacent collapsed stages vertically in one rail slot", () => {
    const { container } = render(
      <StageRail
        stages={STAGES}
        focusedStage="db"
        collapsedStages={{
          cards: true,
          threads: true,
        }}
        onFocusStage={() => undefined}
      />,
    );

    expect(container.querySelectorAll('[data-collapsed-group="true"]').length).toBe(1);
  });

  test("supports the 4-stage order ending in diff", () => {
    const { container } = render(
      <StageRail
        stages={STAGES}
        focusedStage="files"
        onFocusStage={() => undefined}
      />,
    );

    expect(textContent(container).includes("Views")).toBeTrue();
    expect(textContent(container).includes("Cards")).toBeTrue();
    expect(textContent(container).includes("Threads")).toBeTrue();
    expect(textContent(container).includes("Diffs")).toBeTrue();
  });

  test("sliding-window mode renders requested visible panes", () => {
    const { container } = render(
      <StageRail
        stages={STAGES}
        layoutMode="sliding-window"
        focusedStage="threads"
        stageNavDirection="left"
        slidingWindowPaneCount={3}
        onFocusStage={() => undefined}
      />,
    );

    expect(container.querySelector('[data-layout-mode="sliding-window"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-stage-pane^="window-"]').length).toBe(3);
    expect(container.querySelectorAll('[role="separator"]').length).toBe(2);
  });

  test("sliding-window mode supports single-pane layout", () => {
    const { container } = render(
      <StageRail
        stages={STAGES}
        layoutMode="sliding-window"
        focusedStage="cards"
        slidingWindowPaneCount={1}
        onFocusStage={() => undefined}
      />,
    );

    expect(container.querySelector('[data-layout-mode="sliding-window"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-stage-pane^="window-"]').length).toBe(1);
    expect(container.querySelectorAll('[role="separator"]').length).toBe(0);
  });

  test("sliding-window mode degrades gracefully when ResizeObserver is unavailable", () => {
    const originalResizeObserver = globalThis.ResizeObserver;
    Reflect.deleteProperty(globalThis as typeof globalThis & { ResizeObserver?: typeof ResizeObserver }, "ResizeObserver");

    try {
      const { container } = render(
        <StageRail
          stages={STAGES}
          layoutMode="sliding-window"
          focusedStage="threads"
          slidingWindowPaneCount={3}
          onFocusStage={() => undefined}
        />,
      );

      expect(container.querySelector('[data-layout-mode="sliding-window"]')).not.toBeNull();
      expect(container.querySelectorAll('[data-stage-pane^="window-"]').length).toBe(3);
    } finally {
      if (typeof originalResizeObserver === "undefined") {
        Reflect.deleteProperty(globalThis as typeof globalThis & { ResizeObserver?: typeof ResizeObserver }, "ResizeObserver");
      } else {
        Object.defineProperty(globalThis, "ResizeObserver", {
          configurable: true,
          writable: true,
          value: originalResizeObserver,
        });
      }
    }
  });
});
