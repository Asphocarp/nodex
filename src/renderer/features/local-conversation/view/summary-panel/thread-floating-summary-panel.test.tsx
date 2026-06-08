import { beforeEach, describe, expect, mock, test } from "bun:test";
import { fireEvent, waitFor } from "@testing-library/react";
import type {
  GitReviewSnapshot,
  GitReviewSource,
} from "../../../../lib/types";
import { render, settleAsyncRender, textContent } from "../../../../test/dom";

let invokeCalls: unknown[][] = [];
let mockInvokeImpl: ((channel: string, ...args: unknown[]) => Promise<unknown>) | null = null;

mock.module("../../../../lib/api", () => ({
  invoke: async (channel: string, ...args: unknown[]) => {
    invokeCalls.push([channel, ...args]);
    return mockInvokeImpl?.(channel, ...args) ?? null;
  },
}));

function makeSnapshot(source: GitReviewSource, additions: number, deletions: number): GitReviewSnapshot {
  return {
    cwd: "/repo/project",
    source,
    patch: "",
    files: additions > 0 || deletions > 0
      ? [{
          path: `${source}.ts`,
          previousPath: null,
          status: "modified",
          additions,
          deletions,
        }]
      : [],
    isGitRepository: true,
    baseRef: "main",
    currentBranch: "feature/summary-panel",
    defaultBranch: "main",
    errorMessage: null,
  };
}

describe("ThreadFloatingSummaryPanel", () => {
  beforeEach(() => {
    invokeCalls = [];
    mockInvokeImpl = null;
  });

  test("renders the pinned summary without authenticated quota content", async () => {
    const { ThreadFloatingSummaryPanel } = await import("./thread-floating-summary-panel");

    const view = render(
      <ThreadFloatingSummaryPanel
        mounted
        open
        activeThreadId="thread-1"
        cwd={null}
        projectWorkspacePath={null}
        turns={[]}
        onErrorMessage={() => undefined}
      />,
    );

    const outer = view.container.querySelector('[data-thread-summary-panel-mode="pinned"]');
    const motionShell = outer?.querySelector(".origin-top-right") as HTMLElement | null;
    const widthShell = motionShell?.firstElementChild as HTMLElement | null;
    expect(outer?.className.includes("top-(--thread-floating-content-top-inset)")).toBeTrue();
    expect(outer?.className.includes("bottom-(--thread-floating-content-bottom-inset)")).toBeTrue();
    expect(motionShell?.style.opacity).toBe("1");
    expect(motionShell?.style.transform).toBe("none");
    expect(widthShell?.className.includes("pointer-events-auto")).toBeTrue();
    expect(widthShell?.style.width).toBe("300px");
    expect(textContent(view.container).includes("Rate limits")).toBeFalse();
    expect(textContent(view.container).includes("82% · 61%")).toBeFalse();
  });

  test("keeps the hidden Codex shell without running panel side effects", async () => {
    const { ThreadFloatingSummaryPanel } = await import("./thread-floating-summary-panel");

    const view = render(
      <ThreadFloatingSummaryPanel
        mounted
        open={false}
        activeThreadId="thread-1"
        cwd="/repo/project"
        projectWorkspacePath="/repo/project"
        turns={[]}
        onErrorMessage={() => undefined}
      />,
    );

    await settleAsyncRender();

    const outer = view.container.querySelector('[data-thread-summary-panel-open="false"]');
    const motionShell = outer?.querySelector(".origin-top-right") as HTMLElement | null;
    const widthShell = motionShell?.firstElementChild as HTMLElement | null;
    expect(textContent(view.container).includes("Rate limits")).toBeFalse();
    expect(invokeCalls.length).toBe(0);
    expect(motionShell?.style.opacity).toBe("0");
    expect(motionShell?.style.transform).toBe("translateX(100%) scale(0.8)");
    expect(widthShell?.className.includes("pointer-events-none")).toBeTrue();
    expect(widthShell?.style.width).toBe("300px");
  });

  test("renders the right-panel summary as a dismissible popover", async () => {
    const { ThreadSummaryPanelPopover } = await import("./thread-floating-summary-panel");
    const view = render(
      <ThreadSummaryPanelPopover
        activeThreadId="thread-1"
        cwd={null}
        projectWorkspacePath={null}
        turns={[]}
        onErrorMessage={() => undefined}
      />,
    );

    const trigger = view.getByRole("button", { name: "Toggle summary" });
    expect(trigger.getAttribute("aria-pressed")).toBe("false");
    expect(trigger.getAttribute("aria-haspopup")).toBe("dialog");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(trigger);
    await waitFor(() => {
      const popover = view.container.ownerDocument.body.querySelector('[data-thread-summary-panel-mode="popover"]');
      expect(Boolean(popover)).toBeTrue();
    });
    expect(trigger.getAttribute("aria-pressed")).toBe("true");
    expect(trigger.getAttribute("aria-expanded")).toBe("true");

    fireEvent.pointerDown(view.container.ownerDocument.body);
    fireEvent.mouseDown(view.container.ownerDocument.body);
    fireEvent.click(view.container.ownerDocument.body);
    await waitFor(() => {
      const popover = view.container.ownerDocument.body.querySelector('[data-thread-summary-panel-mode="popover"]');
      expect(Boolean(popover)).toBeFalse();
    });
  });

  test("renders git branch and combined diff stats from IPC snapshots", async () => {
    const { ThreadFloatingSummaryPanel } = await import("./thread-floating-summary-panel");
    mockInvokeImpl = async (channel: string, input?: unknown) => {
      if (channel === "git:branch:state") {
        return {
          cwd: "/repo/project",
          currentBranch: "feature/summary-panel",
          branches: [{ name: "feature/summary-panel", current: true }],
          remotes: [],
          errorMessage: null,
        };
      }

      if (channel !== "git:review:snapshot") return null;
      const source = (input as { source: GitReviewSource }).source;
      if (source === "unstaged") return makeSnapshot(source, 2, 1);
      if (source === "staged") return makeSnapshot(source, 3, 4);
      return makeSnapshot(source, 5, 6);
    };

    const view = render(
      <ThreadFloatingSummaryPanel
        mounted
        open
        activeThreadId="thread-1"
        cwd="/repo/project"
        projectWorkspacePath="/repo/project"
        turns={[]}
        onErrorMessage={() => undefined}
      />,
    );

    await settleAsyncRender();
    await waitFor(() => {
      const content = textContent(view.container);
      if (!content.includes("feature/summary-panel") || !content.includes("+10") || !content.includes("-11")) {
        throw new Error(`Expected branch and combined diff stats, saw: ${content}`);
      }
    });

    expect(invokeCalls.some((call) => call[0] === "git:review:snapshot")).toBeTrue();
    expect(invokeCalls.some((call) => call[0] === "git:branch:state")).toBeTrue();
  });
});
