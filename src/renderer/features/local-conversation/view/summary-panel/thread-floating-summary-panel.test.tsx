import { beforeEach, describe, expect, mock, test } from "bun:test";
import { fireEvent, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import type {
  CodexConversationTurn,
  GitReviewSnapshot,
  GitReviewSource,
} from "../../../../lib/types";
import { buildCodexFileChangeMap } from "../../../../../shared/codex-file-change";
import { render, settleAsyncRender, textContent } from "../../../../test/dom";
import { TestQueryProvider } from "../../../../test/query";

let invokeCalls: unknown[][] = [];
let mockInvokeImpl: ((channel: string, ...args: unknown[]) => Promise<unknown>) | null = null;

mock.module("../../../../lib/api", () => ({
  invoke: async (channel: string, ...args: unknown[]) => {
    invokeCalls.push([channel, ...args]);
    return mockInvokeImpl?.(channel, ...args) ?? null;
  },
  subscribeBoardChanges: () => () => undefined,
  subscribeProjectSessionChanges: () => () => undefined,
  subscribeProjectChanges: () => () => undefined,
  subscribeCodexHostMessages: () => () => undefined,
  subscribeDesktopNotificationActions: () => () => undefined,
  subscribeGitBranchChanges: () => () => undefined,
  subscribeAppUpdateStatus: () => () => undefined,
  getWindowFocusState: async () => true,
  subscribeWindowFocusChanges: () => () => undefined,
}));

function renderSummary(ui: ReactElement) {
  return render(<TestQueryProvider>{ui}</TestQueryProvider>);
}

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

    const view = renderSummary(
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
    expect(outer !== null).toBeTrue();
    expect(motionShell?.style.opacity).toBe("1");
    expect(motionShell?.style.transform).toBe("none");
    expect(widthShell?.className.includes("pointer-events-auto")).toBeTrue();
    expect(widthShell?.style.width).toBe("300px");
    expect(textContent(view.container).includes("Rate limits")).toBeFalse();
    expect(textContent(view.container).includes("82% · 61%")).toBeFalse();
  });

  test("keeps the hidden Codex shell without running panel side effects", async () => {
    const { ThreadFloatingSummaryPanel } = await import("./thread-floating-summary-panel");

    const view = renderSummary(
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
    expect(widthShell?.style.width).toBe("300px");
    expect(Boolean(view.container.querySelector("[data-testid='thread-summary-panel']"))).toBeTrue();
  });

  test("uses the Codex instant invisible branch while overlay popover is open", async () => {
    const { ThreadFloatingSummaryPanel } = await import("./thread-floating-summary-panel");

    const view = renderSummary(
      <ThreadFloatingSummaryPanel
        hideImmediately
        mounted
        open={false}
        activeThreadId="thread-1"
        cwd={null}
        projectWorkspacePath={null}
        turns={[]}
        onErrorMessage={() => undefined}
      />,
    );

    const outer = view.container.querySelector("[data-thread-summary-panel-hide-immediately='true']");
    const motionShell = outer?.querySelector(".origin-top-right");
    expect(Boolean(outer)).toBeTrue();
    expect((motionShell as HTMLElement | null)?.style.opacity).toBe("0");
    expect((motionShell as HTMLElement | null)?.style.transform).toBe("translateX(100%) scale(0.8)");
  });

  test("renders the right-panel summary as a dismissible popover", async () => {
    const { ThreadSummaryPanelPopover } = await import("./thread-floating-summary-panel");
    const view = renderSummary(
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

    const view = renderSummary(
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

  test("renders available Codex summary sections in source order", async () => {
    const { ThreadFloatingSummaryPanel } = await import("./thread-floating-summary-panel");
    const turns = [
      {
        items: [
          {
            itemId: "todo",
            type: "plan",
            semanticKind: "todoList",
            markdownText: "- [ ] Inspect shell\n- [x] Wire summary",
          },
          {
            itemId: "file",
            type: "fileChange",
            fileChange: {
              changes: buildCodexFileChangeMap([{
                path: "src/renderer/app.tsx",
                type: "update",
                movePath: null,
                unifiedDiff: "@@ -1 +1 @@\n-old\n+new",
              }]),
            },
          },
          {
            itemId: "agent",
            type: "collabAgentToolCall",
            rawItem: {
              tool: "spawn",
              receiverThreadIds: ["child-1"],
            },
          },
          {
            itemId: "mcp",
            type: "mcpToolCall",
            mcpToolCall: {
              invocation: {
                server: "context7",
              },
            },
          },
          {
            itemId: "web",
            type: "webSearch",
          },
        ],
      },
    ] as unknown as CodexConversationTurn[];

    const view = renderSummary(
      <ThreadFloatingSummaryPanel
        mounted
        open
        activeThreadId="thread-1"
        cwd={null}
        projectWorkspacePath={null}
        turns={turns}
        backgroundTerminalRows={[{
          id: "terminal-1",
          command: "bun test",
          cwd: "/repo/project",
          previewLine: "3 pass",
        }]}
        sideChatRows={[{
          id: "side-chat-1",
          title: "Investigate layout",
          status: "Open",
        }]}
        browserRows={[{
          id: "browser-1",
          title: "Release notes",
          status: "Right panel",
        }]}
        onErrorMessage={() => undefined}
      />,
    );

    const content = textContent(view.container);
    const orderedTitles = [
      "Environment",
      "Progress",
      "Outputs",
      "Side chats",
      "Background subagents",
      "Background tasks",
      "Browser",
      "Sources",
    ];
    const indexes = orderedTitles.map((title) => content.indexOf(title));
    expect(indexes.every((index) => index >= 0)).toBeTrue();
    expect(indexes.join(",")).toBe(indexes.slice().sort((left, right) => left - right).join(","));
    expect(content.includes("Automations")).toBeFalse();
    expect(content.includes("app.tsx")).toBeTrue();
    expect(content.includes("Investigate layout")).toBeTrue();
    expect(content.includes("Release notes")).toBeTrue();
    expect(content.includes("Context7")).toBeTrue();
    expect(content.includes("Web search")).toBeTrue();
    expect(content.includes("bun test")).toBeTrue();
  });
});
