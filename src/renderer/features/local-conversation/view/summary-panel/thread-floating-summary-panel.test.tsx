import { beforeEach, describe, expect, mock, test } from "bun:test";
import { fireEvent, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import type {
  CodexConversationChildMembership,
  CodexConversationSnapshot,
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

function makeSubagentMembership(
  overrides: Partial<CodexConversationChildMembership> = {},
): CodexConversationChildMembership {
  return {
    threadId: "child-1",
    parentThreadId: "thread-1",
    role: "backgroundChild",
    actorName: "Scout",
    displayName: "Scout",
    agentRole: "explorer",
    ...overrides,
  };
}

function makeSubagentConversation(
  overrides: Partial<CodexConversationSnapshot> = {},
): CodexConversationSnapshot {
  return {
    threadId: "child-1",
    projectId: "project-1",
    projectName: "Project",
    title: "Scout thread",
    threadName: "Scout thread",
    threadPreview: "Scout thread",
    agentNickname: "Scout",
    agentRole: "explorer",
    statusType: "active",
    archived: false,
    createdAt: 1_000,
    updatedAt: 1_000,
    resumeState: "resumed",
    turns: [],
    requests: [],
    queuedFollowUps: [],
    pendingSteers: [],
    backgroundTerminalRows: [],
    childMemberships: [],
    capabilityFlags: {
      canCollapseTurns: true,
      canEditLastUserTurn: true,
      canForkFromTurn: true,
      canSearch: true,
    },
    ...overrides,
  } as unknown as CodexConversationSnapshot;
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
            status: "completed",
            rawItem: {
              tool: "spawnAgent",
              status: "completed",
              receiverThreadIds: ["child-1"],
              receiverThreads: [{
                threadId: "child-1",
                thread: {
                  nickname: "Scout",
                  model: "gpt-5-codex",
                  agentRole: "explorer",
                },
              }],
              agentsStates: {
                "child-1": {
                  status: "running",
                  message: null,
                },
              },
              model: "gpt-5-codex",
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
        status: "inProgress",
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
        childMemberships={[makeSubagentMembership()]}
        knownConversationsById={{}}
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
      "Subagents",
      "Background tasks",
      "Browser",
      "Sources",
    ];
    const indexes = orderedTitles.map((title) => content.indexOf(title));
    expect(indexes.every((index) => index >= 0)).toBeTrue();
    expect(indexes.join(",")).toBe(indexes.slice().sort((left, right) => left - right).join(","));
    expect(content.includes("Automations")).toBeFalse();
    expect(content.includes("app.tsx")).toBeTrue();
    expect(content.includes("Scout")).toBeTrue();
    expect(content.includes("Investigate layout")).toBeTrue();
    expect(content.includes("Release notes")).toBeTrue();
    expect(content.includes("Context7")).toBeTrue();
    expect(content.includes("Web search")).toBeTrue();
    expect(content.includes("bun test")).toBeTrue();
  });

  test("opens background subagent rows with subagent opener context", async () => {
    const { ThreadFloatingSummaryPanel } = await import("./thread-floating-summary-panel");
    const turns = [
      {
        turnId: "turn-parent",
        status: "inProgress",
        items: [
          {
            itemId: "agent",
            type: "collabAgentToolCall",
            status: "completed",
            rawItem: {
              tool: "spawnAgent",
              status: "completed",
              receiverThreadIds: ["child-1"],
              receiverThreads: [{
                threadId: "child-1",
                thread: {
                  nickname: "Scout",
                  model: "gpt-5.3-codex",
                  agentRole: "explorer",
                },
              }],
              agentsStates: {
                "child-1": {
                  status: "running",
                  message: null,
                },
              },
              model: "gpt-5.3-codex",
            },
          },
        ],
      },
    ] as unknown as CodexConversationTurn[];
    const openCalls: unknown[] = [];
    const view = renderSummary(
      <ThreadFloatingSummaryPanel
        mounted
        open
        activeThreadId="thread-1"
        cwd={null}
        projectWorkspacePath={null}
        turns={turns}
        childMemberships={[makeSubagentMembership({ displayName: "@Scout" })]}
        knownConversationsById={{
          "child-1": makeSubagentConversation({
            turns: [{
              turnId: "child-turn",
              status: "inProgress",
              diff: "@@ -1 +1,2 @@\n-old\n+new\n+another",
              items: [{
                itemId: "reasoning",
                type: "reasoning",
                semanticKind: "reasoning",
                markdownText: "**Checking files.**",
                rawItem: {
                  summary: [{ text: "**Checking files.**" }],
                },
              }],
            }] as unknown as CodexConversationTurn[],
          }),
        }}
        onOpenThread={(threadId, context) => {
          openCalls.push({ threadId, context });
        }}
        onErrorMessage={() => undefined}
      />,
    );

    const row = view.getByText("Scout").closest("[role='button']") as HTMLElement | null;
    expect(Boolean(row)).toBeTrue();
    fireEvent.click(row as HTMLElement);

    const call = openCalls[0] as {
      threadId?: string;
      context?: {
        subagent?: {
          conversationId?: string;
          displayName?: string;
          agentRole?: string | null;
          showInlineActivity?: boolean;
          spawnModel?: string | null;
          status?: string;
          statusSummary?: string | null;
          diffStats?: { linesAdded?: number; linesRemoved?: number } | null;
        };
      };
    } | undefined;
    expect(openCalls.length).toBe(1);
    expect(call?.threadId).toBe("child-1");
    expect(call?.context?.subagent?.conversationId).toBe("child-1");
    expect(call?.context?.subagent?.displayName).toBe("Scout");
    expect(call?.context?.subagent?.agentRole).toBe("explorer");
    expect(call?.context?.subagent?.spawnModel).toBe("gpt-5.3-codex");
    expect(call?.context?.subagent?.status).toBe("active");
    expect(call?.context?.subagent?.statusSummary).toBe("checking files");
    expect(`${call?.context?.subagent?.diffStats?.linesAdded ?? -1}:${call?.context?.subagent?.diffStats?.linesRemoved ?? -1}`).toBe("2:1");
  });

  test("renders inline subagents as compact strip and lists only non-inline rows", async () => {
    const { ThreadFloatingSummaryPanel } = await import("./thread-floating-summary-panel");
    const openCalls: unknown[] = [];
    const view = renderSummary(
      <ThreadFloatingSummaryPanel
        mounted
        open
        activeThreadId="thread-1"
        cwd={null}
        projectWorkspacePath={null}
        turns={[]}
        childMemberships={[
          makeSubagentMembership({
            threadId: "inline-active",
            displayName: "Inline active",
            showInlineActivity: true,
          }),
          makeSubagentMembership({
            threadId: "inline-waiting",
            displayName: "Inline waiting",
            showInlineActivity: true,
          }),
          makeSubagentMembership({
            threadId: "inline-done",
            displayName: "Inline done",
            showInlineActivity: true,
          }),
          makeSubagentMembership({
            threadId: "listed-active",
            displayName: "Listed active",
            showInlineActivity: false,
          }),
          makeSubagentMembership({
            threadId: "listed-waiting",
            displayName: "Listed waiting",
            showInlineActivity: false,
          }),
        ]}
        knownConversationsById={{
          "inline-active": makeSubagentConversation({
            threadId: "inline-active",
            statusType: "active",
            threadName: "Inline active",
            agentNickname: "Inline active",
          }),
          "inline-waiting": makeSubagentConversation({
            threadId: "inline-waiting",
            statusType: "notLoaded",
            threadName: "Inline waiting",
            agentNickname: "Inline waiting",
          }),
          "inline-done": makeSubagentConversation({
            threadId: "inline-done",
            statusType: "idle",
            threadName: "Inline done",
            agentNickname: "Inline done",
          }),
          "listed-active": makeSubagentConversation({
            threadId: "listed-active",
            statusType: "active",
            threadName: "Listed active",
            agentNickname: "Listed active",
            turns: [{
              turnId: "listed-active-turn",
              status: "inProgress",
              diff: "@@ -1 +1,2 @@\n-old\n+new\n+another",
              items: [],
            }] as unknown as CodexConversationTurn[],
          }),
          "listed-waiting": makeSubagentConversation({
            threadId: "listed-waiting",
            statusType: "notLoaded",
            threadName: "Listed waiting",
            agentNickname: "Listed waiting",
          }),
        }}
        onOpenThread={(threadId, context) => {
          openCalls.push({ threadId, context });
        }}
        onErrorMessage={() => undefined}
      />,
    );

    const content = textContent(view.container);
    expect(Boolean(content.includes("Subagents"))).toBeTrue();
    expect(Boolean(content.includes("2 working"))).toBeTrue();
    expect(Boolean(content.includes("1 done"))).toBeFalse();
    expect(Boolean(content.includes("Listed active"))).toBeTrue();
    expect(Boolean(content.includes("Listed waiting"))).toBeTrue();
    expect(Boolean(content.includes("is working"))).toBeTrue();
    expect(Boolean(content.includes("Waiting"))).toBeFalse();
    expect(Boolean(content.includes("Done"))).toBeFalse();
    expect(Boolean(content.includes("+2"))).toBeTrue();
    expect(Boolean(content.includes("-1"))).toBeTrue();
    expect(view.container.querySelector('[data-subagent-avatar-seed="inline-active"]') !== null).toBeTrue();
    expect(view.container.querySelector('[data-subagent-avatar-seed="inline-waiting"]') !== null).toBeTrue();
    expect(view.container.querySelector('[data-subagent-avatar-seed="inline-done"]') === null).toBeTrue();
    expect(view.container.querySelector('[data-subagent-avatar-seed="listed-active"]') !== null).toBeTrue();

    fireEvent.click(view.getByRole("button", { name: "Open Inline active" }));
    const call = openCalls[0] as {
      threadId?: string;
      context?: { subagent?: { conversationId?: string; showInlineActivity?: boolean } };
    } | undefined;
    expect(call?.threadId).toBe("inline-active");
    expect(call?.context?.subagent?.conversationId).toBe("inline-active");
    expect(call?.context?.subagent?.showInlineActivity).toBeTrue();
  });

  test("uses the last four done inline subagents when no inline subagent is working", async () => {
    const { ThreadFloatingSummaryPanel } = await import("./thread-floating-summary-panel");
    const memberships = [1, 2, 3, 4, 5].map((index) =>
      makeSubagentMembership({
        threadId: `done-inline-${index}`,
        displayName: `Done inline ${index}`,
        showInlineActivity: true,
      })
    );
    const knownConversationsById = Object.fromEntries(
      memberships.map((membership, index) => [
        membership.threadId,
        makeSubagentConversation({
          threadId: membership.threadId,
          statusType: "idle",
          threadName: `Done inline ${index + 1}`,
          agentNickname: `Done inline ${index + 1}`,
        }),
      ]),
    );

    const view = renderSummary(
      <ThreadFloatingSummaryPanel
        mounted
        open
        activeThreadId="thread-1"
        cwd={null}
        projectWorkspacePath={null}
        turns={[]}
        childMemberships={memberships}
        knownConversationsById={knownConversationsById}
        onErrorMessage={() => undefined}
      />,
    );

    const content = textContent(view.container);
    expect(Boolean(content.includes("4 done"))).toBeTrue();
    expect(view.container.querySelector('[data-subagent-avatar-seed="done-inline-1"]') === null).toBeTrue();
    expect(view.container.querySelector('[data-subagent-avatar-seed="done-inline-2"]') !== null).toBeTrue();
    expect(view.container.querySelector('[data-subagent-avatar-seed="done-inline-5"]') !== null).toBeTrue();
  });
});
