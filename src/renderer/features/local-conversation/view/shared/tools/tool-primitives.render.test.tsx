import { describe, expect, test } from "bun:test";
import { act, fireEvent, waitFor } from "@testing-library/react";
import { render, textContent } from "../../../../../test/dom";
import {
  ThreadActivityDisclosure,
  ThreadActivityHeader,
  ThreadActivityList,
  THREAD_ACTIVITY_LIST_7_TO_20_REM_MAX_HEIGHT_BY_STATE,
  THREAD_ACTIVITY_LIST_20_REM_MAX_HEIGHT_BY_STATE,
  ThreadActivityShell,
  ThreadActivitySummaryText,
} from "./tool-primitives";

describe("ThreadActivityShell", () => {
  test("renders a static activity header without disclosure button semantics", () => {
    const { container } = render(
      <ThreadActivityShell
        testId="activity-shell"
        header={<ThreadActivityHeader testId="activity-header">Read file</ThreadActivityHeader>}
        body={<div data-testid="activity-body">details</div>}
      />,
    );

    const header = container.querySelector<HTMLElement>("[data-testid='activity-header']");
    expect(header?.tagName).toBe("DIV");
    expect(Boolean(container.querySelector("button[aria-expanded]"))).toBeFalse();
    expect(Boolean(container.querySelector("[data-testid='activity-body']"))).toBeTrue();
    expect(Boolean(textContent(container).includes("Read file"))).toBeTrue();
  });

  test("renders disclosure headers as buttons and forwards toggle events", async () => {
    let toggleCount = 0;
    const view = render(
      <ThreadActivityShell
        header={(
          <ThreadActivityHeader
            testId="activity-header"
            disclosure={{
              expanded: false,
              onToggle: () => {
                toggleCount += 1;
              },
            }}
          >
            Searching the web
          </ThreadActivityHeader>
        )}
      />,
    );

    const collapsedButton = view.container.querySelector<HTMLButtonElement>("[data-testid='activity-header']");
    expect(collapsedButton?.tagName).toBe("BUTTON");
    expect(collapsedButton?.getAttribute("aria-expanded") ?? "").toBe("false");

    await act(async () => {
      fireEvent.click(collapsedButton as HTMLButtonElement);
      await Promise.resolve();
    });

    expect(toggleCount).toBe(1);

    view.rerender(
      <ThreadActivityShell
        header={(
          <ThreadActivityHeader
            testId="activity-header"
            disclosure={{
              expanded: true,
              onToggle: () => {
                toggleCount += 1;
              },
            }}
          >
            Searching the web
          </ThreadActivityHeader>
        )}
        body={<div data-testid="activity-body">result</div>}
      />,
    );

    const expandedButton = view.container.querySelector<HTMLButtonElement>("[data-testid='activity-header']");
    expect(expandedButton?.getAttribute("aria-expanded") ?? "").toBe("true");
    expect(Boolean(view.container.querySelector("[data-testid='activity-body']"))).toBeTrue();
  });
});

describe("ThreadActivityDisclosure", () => {
  test("separates first-open body mount from expanded state with requestAnimationFrame", async () => {
    const originalRequestAnimationFrame = window.requestAnimationFrame;
    const originalCancelAnimationFrame = window.cancelAnimationFrame;
    const pendingFrames: FrameRequestCallback[] = [];
    let expandCount = 0;
    window.requestAnimationFrame = (callback: FrameRequestCallback) => {
      pendingFrames.push(callback);
      return pendingFrames.length;
    };
    window.cancelAnimationFrame = () => {};

    try {
      const { container } = render(
        <ThreadActivityDisclosure
          bodyTestId="activity-body"
          headerTestId="activity-header"
          onExpand={() => {
            expandCount += 1;
          }}
          summary="Edited a file"
        >
          <div>patch rows</div>
        </ThreadActivityDisclosure>,
      );

      const button = container.querySelector<HTMLButtonElement>("[data-testid='activity-header']");
      expect(button?.getAttribute("aria-expanded") ?? "").toBe("false");
      expect(Boolean(container.querySelector("[data-testid='activity-body']"))).toBeFalse();

      await act(async () => {
        fireEvent.click(button as HTMLButtonElement);
        await Promise.resolve();
      });

      const mountedBeforeFrame = container.querySelector<HTMLElement>("[data-testid='activity-body']");
      expect(expandCount).toBe(1);
      expect(button?.getAttribute("aria-expanded") ?? "").toBe("false");
      expect(Boolean(mountedBeforeFrame)).toBeTrue();
      expect(mountedBeforeFrame?.getAttribute("data-thread-find-skip") ?? "").toBe("true");
      expect(mountedBeforeFrame?.style.pointerEvents ?? "").toBe("none");

      await act(async () => {
        const nextFrame = pendingFrames.shift();
        nextFrame?.(0);
        await Promise.resolve();
      });

      const expandedBody = container.querySelector<HTMLElement>("[data-testid='activity-body']");
      expect(button?.getAttribute("aria-expanded") ?? "").toBe("true");
      expect(Boolean(expandedBody)).toBeTrue();
      expect(expandedBody?.getAttribute("data-thread-find-skip") ?? "").toBe("");
      expect(expandedBody?.style.pointerEvents ?? "").toBe("auto");
    } finally {
      window.requestAnimationFrame = originalRequestAnimationFrame;
      window.cancelAnimationFrame = originalCancelAnimationFrame;
    }
  });

  test("keeps the body mounted while collapsing and unmounts after animation completion", async () => {
    const { container } = render(
      <ThreadActivityDisclosure
        bodyTestId="activity-body"
        defaultExpanded
        headerTestId="activity-header"
        summary="Searched the web"
        transition={{ duration: 0.02 }}
      >
        <div>search rows</div>
      </ThreadActivityDisclosure>,
    );

    const button = container.querySelector<HTMLButtonElement>("[data-testid='activity-header']");
    expect(button?.getAttribute("aria-expanded") ?? "").toBe("true");
    expect(Boolean(container.querySelector("[data-testid='activity-body']"))).toBeTrue();

    await act(async () => {
      fireEvent.click(button as HTMLButtonElement);
      await Promise.resolve();
    });

    const collapsingBody = container.querySelector<HTMLElement>("[data-testid='activity-body']");
    expect(button?.getAttribute("aria-expanded") ?? "").toBe("false");
    expect(Boolean(collapsingBody)).toBeTrue();
    expect(collapsingBody?.getAttribute("data-thread-find-skip") ?? "").toBe("true");
    expect(collapsingBody?.style.pointerEvents ?? "").toBe("none");

    await waitFor(() => {
      if (container.querySelector("[data-testid='activity-body']")) {
        throw new Error("Expected collapsed body to unmount");
      }
    });
  });

  test("can mount an initially collapsed body for first-render collapse animation", () => {
    const { container } = render(
      <ThreadActivityDisclosure
        bodyTestId="activity-body"
        headerTestId="activity-header"
        shouldAnimateInitialCollapse
        summary="Edited files"
      >
        <div>initial body</div>
      </ThreadActivityDisclosure>,
    );

    const button = container.querySelector<HTMLButtonElement>("[data-testid='activity-header']");
    const body = container.querySelector<HTMLElement>("[data-testid='activity-body']");
    expect(button?.getAttribute("aria-expanded") ?? "").toBe("false");
    expect(Boolean(body)).toBeTrue();
    expect(body?.getAttribute("data-thread-find-skip") ?? "").toBe("true");
    expect(body?.style.pointerEvents ?? "").toBe("none");
  });

  test("renders static headers and no body when expansion is disabled", () => {
    const { container } = render(
      <ThreadActivityDisclosure
        bodyTestId="activity-body"
        canExpand={false}
        headerTestId="activity-header"
        summary="Called tool"
      >
        <div>hidden rows</div>
      </ThreadActivityDisclosure>,
    );

    const header = container.querySelector<HTMLElement>("[data-testid='activity-header']");
    expect(header?.tagName).toBe("DIV");
    expect(Boolean(container.querySelector("button[aria-expanded]"))).toBeFalse();
    expect(Boolean(container.querySelector("[data-testid='activity-body']"))).toBeFalse();
  });
});

describe("ThreadActivitySummaryText", () => {
  test("renders static summary changes immediately", () => {
    const view = render(
      <ThreadActivitySummaryText summaryKey="old" summaryTransition="static">
        Edited a file
      </ThreadActivitySummaryText>,
    );

    view.rerender(
      <ThreadActivitySummaryText summaryKey="new" summaryTransition="static">
        Edited 2 files
      </ThreadActivitySummaryText>,
    );

    expect(textContent(view.container)).toBe("Edited 2 files");
  });

  test("renders immediate summary changes without waiting for the defer window", async () => {
    const originalDateNow = Date.now;
    let now = 0;
    Date.now = () => now;

    try {
      const view = render(
        <ThreadActivitySummaryText summaryKey="old" summaryTransition="deferred">
          Searching the web
        </ThreadActivitySummaryText>,
      );

      now = 100;
      await act(async () => {
        view.rerender(
          <ThreadActivitySummaryText summaryKey="new" summaryTransition="immediate">
            Searched the web
          </ThreadActivitySummaryText>,
        );
        await Promise.resolve();
      });

      expect(textContent(view.container)).toBe("Searched the web");
    } finally {
      Date.now = originalDateNow;
    }
  });

  test("defers keyed summary changes until the 1000ms commit window elapses", async () => {
    const originalDateNow = Date.now;
    const originalSetTimeout = window.setTimeout;
    const originalClearTimeout = window.clearTimeout;
    let now = 0;
    let nextTimerId = 900_000;
    let scheduledTimerId: number | null = null;
    let scheduledDelay = -1;
    let scheduledCallback: (() => void) | null = null;
    Date.now = () => now;
    window.setTimeout = ((callback: TimerHandler, delay?: number) => {
      const timerId = nextTimerId++;
      scheduledTimerId = timerId;
      scheduledDelay = delay ?? 0;
      scheduledCallback = typeof callback === "function" ? () => callback() : null;
      return timerId;
    }) as typeof window.setTimeout;
    window.clearTimeout = ((timerId?: number) => {
      if (timerId !== scheduledTimerId) return;
      scheduledCallback = null;
      scheduledTimerId = null;
    }) as typeof window.clearTimeout;

    try {
      const view = render(
        <ThreadActivitySummaryText summaryKey="old" summaryTransition="deferred">
          Editing src/old.ts
        </ThreadActivitySummaryText>,
      );

      now = 100;
      await act(async () => {
        view.rerender(
          <ThreadActivitySummaryText summaryKey="new" summaryTransition="deferred">
            Editing src/new.ts
          </ThreadActivitySummaryText>,
        );
        await Promise.resolve();
      });

      expect(textContent(view.container)).toBe("Editing src/old.ts");
      expect(scheduledDelay).toBe(900);
      expect(Boolean(scheduledCallback)).toBeTrue();

      now = 1000;
      await act(async () => {
        scheduledCallback?.();
        await Promise.resolve();
      });

      expect(textContent(view.container)).toBe("Editing src/new.ts");
    } finally {
      Date.now = originalDateNow;
      window.setTimeout = originalSetTimeout;
      window.clearTimeout = originalClearTimeout;
    }
  });

  test("immediate summary changes cancel a pending deferred update", async () => {
    const originalDateNow = Date.now;
    const originalSetTimeout = window.setTimeout;
    const originalClearTimeout = window.clearTimeout;
    let now = 0;
    let nextTimerId = 910_000;
    let scheduledTimerId: number | null = null;
    let clearCount = 0;
    let scheduledCallback: (() => void) | null = null;
    Date.now = () => now;
    window.setTimeout = ((callback: TimerHandler) => {
      const timerId = nextTimerId++;
      scheduledTimerId = timerId;
      scheduledCallback = typeof callback === "function" ? () => callback() : null;
      return timerId;
    }) as typeof window.setTimeout;
    window.clearTimeout = ((timerId?: number) => {
      if (timerId !== scheduledTimerId) return;
      clearCount += 1;
      scheduledCallback = null;
      scheduledTimerId = null;
    }) as typeof window.clearTimeout;

    try {
      const view = render(
        <ThreadActivitySummaryText summaryKey="old" summaryTransition="deferred">
          Running old step
        </ThreadActivitySummaryText>,
      );

      now = 100;
      await act(async () => {
        view.rerender(
          <ThreadActivitySummaryText summaryKey="deferred" summaryTransition="deferred">
            Running deferred step
          </ThreadActivitySummaryText>,
        );
        await Promise.resolve();
      });
      expect(Boolean(scheduledCallback)).toBeTrue();

      now = 150;
      await act(async () => {
        view.rerender(
          <ThreadActivitySummaryText summaryKey="final" summaryTransition="immediate">
            Final summary
          </ThreadActivitySummaryText>,
        );
        await Promise.resolve();
      });

      expect(clearCount).toBe(1);
      expect(Boolean(scheduledCallback)).toBeFalse();
      expect(textContent(view.container)).toBe("Final summary");
    } finally {
      Date.now = originalDateNow;
      window.setTimeout = originalSetTimeout;
      window.clearTimeout = originalClearTimeout;
    }
  });
});

describe("ThreadActivityList", () => {
  const items = [
    { key: "first", node: <span data-testid="first-row">first</span> },
    { key: "second", node: <span data-testid="second-row">second</span> },
  ];

  test("renders preview lists as bounded fade-mask scroll containers", () => {
    const { container } = render(
      <ThreadActivityList
        items={items}
        maxHeightByState={THREAD_ACTIVITY_LIST_7_TO_20_REM_MAX_HEIGHT_BY_STATE}
        testId="activity-list"
      />,
    );

    const list = container.querySelector<HTMLElement>("[data-testid='activity-list']");
    const content = list?.firstElementChild as HTMLElement | null;
    expect(Boolean(list)).toBeTrue();
    expect(list?.style.maxHeight ?? "").toBe("7rem");
    expect(Boolean(list?.classList.contains("vertical-scroll-fade-mask"))).toBeTrue();
    expect(Boolean(list?.classList.contains("flex-col-reverse"))).toBeTrue();
    expect(Boolean(list?.classList.contains("overflow-x-hidden"))).toBeTrue();
    expect(Boolean(content?.classList.contains("pb-1"))).toBeTrue();
    expect(textContent(content ?? container)).toBe("firstsecond");
  });

  test("uses view state to hide collapsed rows while retaining the list shell", () => {
    const view = render(
      <ThreadActivityList
        items={items}
        maxHeightByState={THREAD_ACTIVITY_LIST_20_REM_MAX_HEIGHT_BY_STATE}
        testId="activity-list"
        viewState="expanded"
      />,
    );

    const expandedList = view.container.querySelector<HTMLElement>("[data-testid='activity-list']");
    expect(expandedList?.style.maxHeight ?? "").toBe("20rem");
    expect(Boolean(view.container.querySelector("[data-testid='first-row']"))).toBeTrue();

    view.rerender(
      <ThreadActivityList
        items={items}
        maxHeightByState={THREAD_ACTIVITY_LIST_20_REM_MAX_HEIGHT_BY_STATE}
        testId="activity-list"
        viewState="collapsed"
      />,
    );

    const collapsedList = view.container.querySelector<HTMLElement>("[data-testid='activity-list']");
    expect(Boolean(collapsedList)).toBeTrue();
    expect(collapsedList?.style.maxHeight ?? "").toBe("0px");
    expect(Boolean(view.container.querySelector("[data-testid='first-row']"))).toBeFalse();
    expect(textContent(collapsedList ?? view.container)).toBe("");
  });

  test("can opt out of reverse auto-scroll, horizontal clipping, and max-height", () => {
    const { container } = render(
      <ThreadActivityList
        allowHorizontalScroll
        autoScrollToBottom={false}
        disableMaxHeight
        items={items}
        maxHeightByState={THREAD_ACTIVITY_LIST_7_TO_20_REM_MAX_HEIGHT_BY_STATE}
        testId="activity-list"
        viewState="expanded"
      />,
    );

    const list = container.querySelector<HTMLElement>("[data-testid='activity-list']");
    expect(Boolean(list?.classList.contains("flex-col-reverse"))).toBeFalse();
    expect(Boolean(list?.classList.contains("overflow-x-hidden"))).toBeFalse();
    expect(list?.style.maxHeight ?? "").toBe("");
    expect(textContent(list ?? container)).toBe("firstsecond");
  });
});
