import { beforeEach, describe, expect, test } from "vite-plus/test";
import { act, fireEvent, waitFor } from "@testing-library/react";
import { render, textContent } from "../../../../../test/dom";
import {
  installElementScrollHeight,
  installMeasuredResizeObserver,
} from "../../../../../test/browser-globals";
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
    expect(Boolean(container.querySelector("button[aria-expanded]"))).toBe(false);
    expect(Boolean(container.querySelector("[data-testid='activity-body']"))).toBe(true);
    expect(Boolean(textContent(container).includes("Read file"))).toBe(true);
  });

  test("renders disclosure headers as buttons and forwards toggle events", async () => {
    let toggleCount = 0;
    const view = render(
      <ThreadActivityShell
        header={
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
        }
      />,
    );

    const collapsedButton = view.container.querySelector<HTMLButtonElement>(
      "[data-testid='activity-header']",
    );
    expect(collapsedButton?.tagName).toBe("BUTTON");
    expect(collapsedButton?.getAttribute("aria-expanded") ?? "").toBe("false");

    await act(async () => {
      fireEvent.click(collapsedButton as HTMLButtonElement);
      await Promise.resolve();
    });

    expect(toggleCount).toBe(1);

    view.rerender(
      <ThreadActivityShell
        header={
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
        }
        body={<div data-testid="activity-body">result</div>}
      />,
    );

    const expandedButton = view.container.querySelector<HTMLButtonElement>(
      "[data-testid='activity-header']",
    );
    expect(expandedButton?.getAttribute("aria-expanded") ?? "").toBe("true");
    expect(Boolean(view.container.querySelector("[data-testid='activity-body']"))).toBe(true);
  });
});

describe("ThreadActivityDisclosure", () => {
  beforeEach(() => {
    installElementScrollHeight(120);
    installMeasuredResizeObserver({ blockSize: 120, inlineSize: 320 });
  });

  test("uses a rich overlay button labelled by its summary while preserving nested controls", () => {
    const { container } = render(
      <ThreadActivityDisclosure
        status="completed"
        headerTestId="activity-header"
        icon={<span aria-hidden="true">icon</span>}
        summary={
          <a href="/file.ts" data-agent-activity-file-link>
            Edited file.ts
          </a>
        }
      >
        <div>patch rows</div>
      </ThreadActivityDisclosure>,
    );

    const header = container.querySelector<HTMLElement>("[data-testid='activity-header']");
    const overlayButton = header?.querySelector<HTMLButtonElement>(":scope > button");
    const summary = header?.querySelector<HTMLElement>("[id]");
    expect(header?.tagName).toBe("DIV");
    expect(overlayButton?.getAttribute("aria-labelledby") ?? "").toBe(summary?.id ?? "missing");
    expect(overlayButton?.getAttribute("aria-expanded") ?? "").toBe("false");
    expect(Boolean(header?.querySelector("a[data-agent-activity-file-link]"))).toBe(true);
  });

  test("prefers an explicit accessible label for a rich overlay button", () => {
    const { container } = render(
      <ThreadActivityDisclosure
        status="completed"
        accessibleLabel="Toggle activity details"
        headerTestId="activity-header"
        icon={<span aria-hidden="true">icon</span>}
        summary="Edited file.ts"
      >
        <div>patch rows</div>
      </ThreadActivityDisclosure>,
    );

    const button = container.querySelector<HTMLButtonElement>(
      "[data-testid='activity-header'] > button",
    );
    expect(button?.getAttribute("aria-label") ?? "").toBe("Toggle activity details");
    expect(button?.getAttribute("aria-labelledby") ?? "").toBe("");
  });

  test("keeps a collapsed body mounted, hidden, inert, and measured across toggles", async () => {
    let expandCount = 0;
    const { container } = render(
      <ThreadActivityDisclosure
        status="completed"
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
    const collapsedBody = container.querySelector<HTMLElement>("[data-testid='activity-body']");
    expect(button?.getAttribute("aria-expanded") ?? "").toBe("false");
    expect(Boolean(collapsedBody)).toBe(true);
    expect(collapsedBody?.getAttribute("aria-hidden")).toBe("true");
    expect(collapsedBody?.hasAttribute("inert")).toBe(true);
    expect(collapsedBody?.style.pointerEvents ?? "").toBe("none");
    expect(textContent(collapsedBody as HTMLElement)).toContain("patch rows");

    await act(async () => {
      fireEvent.click(button as HTMLButtonElement);
      await Promise.resolve();
    });

    const expandedBody = container.querySelector<HTMLElement>("[data-testid='activity-body']");
    expect(expandCount).toBe(1);
    expect(expandedBody).toBe(collapsedBody);
    expect(button?.getAttribute("aria-expanded") ?? "").toBe("true");
    expect(expandedBody?.getAttribute("aria-hidden")).toBe("false");
    expect(expandedBody?.hasAttribute("inert")).toBe(false);
    expect(expandedBody?.style.pointerEvents ?? "").toBe("auto");
    await waitFor(() => {
      expect(expandedBody?.style.height).toBe("120px");
    });

    await act(async () => {
      fireEvent.click(button as HTMLButtonElement);
      await Promise.resolve();
    });
    expect(container.querySelector<HTMLElement>("[data-testid='activity-body']")).toBe(
      collapsedBody,
    );
    expect(button?.getAttribute("aria-expanded") ?? "").toBe("false");
    expect(collapsedBody?.getAttribute("aria-hidden")).toBe("true");
    expect(collapsedBody?.hasAttribute("inert")).toBe(true);
    expect(collapsedBody?.style.pointerEvents ?? "").toBe("none");
  });

  test("opens running activities by default and preserves a manual collapse", async () => {
    const view = render(
      <ThreadActivityDisclosure
        autoExpandWhileRunning
        bodyTestId="activity-body"
        headerTestId="activity-header"
        status="running"
        summary="Creating a worktree"
      >
        <div>Preparing worktree</div>
      </ThreadActivityDisclosure>,
    );
    const button = view.container.querySelector<HTMLButtonElement>(
      "[data-testid='activity-header']",
    );
    expect(button?.getAttribute("aria-expanded")).toBe("true");

    await act(async () => {
      fireEvent.click(button as HTMLButtonElement);
      await Promise.resolve();
    });
    expect(button?.getAttribute("aria-expanded")).toBe("false");

    view.rerender(
      <ThreadActivityDisclosure
        autoExpandWhileRunning
        bodyTestId="activity-body"
        headerTestId="activity-header"
        status="running"
        summary="Creating a worktree"
      >
        <div>Preparing worktree with more output</div>
      </ThreadActivityDisclosure>,
    );
    expect(button?.getAttribute("aria-expanded")).toBe("false");
  });

  test("preserves an expanded body node across streaming summary updates", async () => {
    const view = render(
      <ThreadActivityDisclosure
        status="running"
        defaultExpanded
        headerTestId="activity-header"
        summary="Running command"
        summaryKey="active:command"
        summaryTransition="deferred"
      >
        <div data-testid="stable-activity-body">stream output</div>
      </ThreadActivityDisclosure>,
    );
    const initialBody = view.container.querySelector<HTMLElement>(
      "[data-testid='stable-activity-body']",
    );

    await act(async () => {
      view.rerender(
        <ThreadActivityDisclosure
          status="completed"
          defaultExpanded
          headerTestId="activity-header"
          summary="Ran command"
          summaryKey="summary"
          summaryTransition="immediate"
        >
          <div data-testid="stable-activity-body">stream output complete</div>
        </ThreadActivityDisclosure>,
      );
      await Promise.resolve();
    });

    const updatedBody = view.container.querySelector<HTMLElement>(
      "[data-testid='stable-activity-body']",
    );
    expect(updatedBody).toBe(initialBody);
    expect(
      view.container
        .querySelector("[data-testid='activity-header']")
        ?.getAttribute("aria-expanded") ?? "",
    ).toBe("true");
  });

  test("renders static headers and no body when expansion is disabled", () => {
    const { container } = render(
      <ThreadActivityDisclosure
        status="completed"
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
    expect(Boolean(container.querySelector("button[aria-expanded]"))).toBe(false);
    expect(Boolean(container.querySelector("[data-testid='activity-body']"))).toBe(false);
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
      expect(Boolean(scheduledCallback)).toBe(true);

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
      expect(Boolean(scheduledCallback)).toBe(true);

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
      expect(Boolean(scheduledCallback)).toBe(false);
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
    expect(Boolean(list)).toBe(true);
    expect(list?.style.maxHeight ?? "").toBe("7rem");
    expect(Boolean(list?.classList.contains("vertical-scroll-fade-mask"))).toBe(true);
    expect(Boolean(list?.classList.contains("flex-col-reverse"))).toBe(true);
    expect(Boolean(list?.classList.contains("overflow-x-hidden"))).toBe(true);
    expect(Boolean(content?.classList.contains("pb-1"))).toBe(true);
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
    expect(Boolean(view.container.querySelector("[data-testid='first-row']"))).toBe(true);

    view.rerender(
      <ThreadActivityList
        items={items}
        maxHeightByState={THREAD_ACTIVITY_LIST_20_REM_MAX_HEIGHT_BY_STATE}
        testId="activity-list"
        viewState="collapsed"
      />,
    );

    const collapsedList = view.container.querySelector<HTMLElement>(
      "[data-testid='activity-list']",
    );
    expect(Boolean(collapsedList)).toBe(true);
    expect(collapsedList?.style.maxHeight ?? "").toBe("0px");
    expect(Boolean(view.container.querySelector("[data-testid='first-row']"))).toBe(false);
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
    expect(Boolean(list?.classList.contains("flex-col-reverse"))).toBe(false);
    expect(Boolean(list?.classList.contains("overflow-x-hidden"))).toBe(false);
    expect(list?.style.maxHeight ?? "").toBe("");
    expect(textContent(list ?? container)).toBe("firstsecond");
  });
});
