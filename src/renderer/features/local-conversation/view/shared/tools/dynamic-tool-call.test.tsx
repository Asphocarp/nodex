import { describe, expect, test } from "bun:test";
import { fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import type { CodexTranscriptEntry } from "../../../../../lib/types";
import { render, textContent } from "../../../../../test/dom";
import { DynamicToolCall } from "./dynamic-tool-call";

function buildDynamicEntry(overrides?: Partial<NonNullable<CodexTranscriptEntry["dynamicToolCall"]>>): CodexTranscriptEntry {
  const dynamicToolCall: NonNullable<CodexTranscriptEntry["dynamicToolCall"]> = {
    callId: "dynamic-1",
    namespace: "codex_app",
    tool: "read_thread",
    arguments: { threadId: "thread-1" },
    status: "completed",
    contentItems: [{ type: "inputText", text: "{\"schemaVersion\":1}" }],
    success: true,
    durationMs: 12,
    completed: true,
    ...overrides,
  };

  return {
    threadId: "thread-1",
    turnId: "turn-1",
    itemId: "dynamic-1",
    entryId: "dynamic-1",
    type: "dynamicToolCall",
    kind: "toolCall",
    semanticKind: "dynamicToolCall",
    status: "completed",
    toolCall: {
      subtype: "dynamic",
      toolName: dynamicToolCall.tool,
      server: dynamicToolCall.namespace ?? undefined,
      args: dynamicToolCall.arguments,
      result: dynamicToolCall.contentItems ?? undefined,
    },
    dynamicToolCall,
    createdAt: 1,
    updatedAt: 1,
  };
}

function renderWithQueryClient(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      {ui}
    </QueryClientProvider>,
  );
}

describe("DynamicToolCall", () => {
  test("renders Codex app meta thread calls as compact rows", () => {
    const { container } = render(<DynamicToolCall item={buildDynamicEntry()} />);

    expect(textContent(container)).toBe("Read thread");
    expect(textContent(container).includes("schemaVersion")).toBeFalse();
    expect(textContent(container).includes("Arguments")).toBeFalse();
  });

  test("renders navigable Codex app thread rows through the registry renderer", () => {
    const openedThreads: string[] = [];
    const { getByRole } = render(
      <DynamicToolCall
        item={buildDynamicEntry()}
        onOpenThread={(threadId) => {
          openedThreads.push(threadId);
        }}
      />,
    );

    fireEvent.click(getByRole("button", { name: "Read thread" }));

    expect(openedThreads.join(",")).toBe("thread-1");
  });

  test("renders completed create_thread success as an open-chat card", () => {
    const openedThreads: string[] = [];
    const { getByRole, container } = render(
      <DynamicToolCall
        item={buildDynamicEntry({
          tool: "create_thread",
          arguments: {
            prompt: "Continue in a background chat",
            target: { type: "projectless" },
          },
          contentItems: [{ type: "inputText", text: "{\"threadId\":\"thread-created\"}" }],
        })}
        onOpenThread={(threadId) => {
          openedThreads.push(threadId);
        }}
      />,
    );

    expect(textContent(container).includes("Chat created")).toBeTrue();
    expect(textContent(container).includes("Open chat")).toBeTrue();
    expect(getByRole("button").getAttribute("aria-label")).toBe("Open chat");

    fireEvent.click(getByRole("button"));

    expect(openedThreads.join(",")).toBe("thread-created");
  });

  test("keeps create_thread worktree setup card on the pending-worktree hash fallback", () => {
    const previousHash = window.location.hash;
    window.location.hash = "";

    try {
      const { getByRole, container } = render(
        <DynamicToolCall
          item={buildDynamicEntry({
            tool: "create_thread",
            arguments: {
              prompt: "Continue in a worktree chat",
              target: {
                type: "project",
                projectId: "project-1",
                environment: { type: "worktree" },
              },
            },
            contentItems: [{ type: "inputText", text: "{\"pendingWorktreeId\":\"pending-worktree\"}" }],
          })}
        />,
      );

      expect(textContent(container).includes("Worktree chat queued")).toBeTrue();
      expect(textContent(container).includes("Open setup")).toBeTrue();

      fireEvent.click(getByRole("button"));

      expect(window.location.hash).toBe("#/worktrees/pending/pending-worktree");
    } finally {
      window.location.hash = previousHash;
    }
  });

  test("renders handoff_thread as a status activity when operation steps are available", () => {
    const { container, getByRole } = render(
      <DynamicToolCall
        item={buildDynamicEntry({
          tool: "handoff_thread",
          arguments: { threadId: "thread-target" },
          status: "completed",
          completed: true,
          success: true,
          contentItems: [{
            type: "inputText",
            text: JSON.stringify({
              destinationHostDisplayName: "Local",
              operationId: "operation-1",
              status: "running",
              steps: [
                { id: "resolve-thread", label: "Resolve thread", status: "success", message: null },
                { id: "handoff", label: "Move thread", status: "running", message: "Preparing thread handoff." },
              ],
            }),
          }],
        })}
      />,
    );

    expect(getByRole("button", { name: /Handing off thread/i }).getAttribute("aria-expanded")).toBe("true");
    expect(textContent(container).includes("Resolve thread")).toBeTrue();
    expect(textContent(container).includes("Move thread")).toBeTrue();
    expect(textContent(container).includes("Arguments")).toBeFalse();
  });

  test("renders settings and Chrome tab-context calls with registered labels", () => {
    const { container: settings } = render(
      <DynamicToolCall
        item={buildDynamicEntry({
          tool: "read_settings",
          arguments: {},
          status: "inProgress",
          contentItems: null,
          success: null,
          durationMs: null,
          completed: false,
        })}
      />,
    );
    const { container: chrome } = render(
      <DynamicToolCall
        item={buildDynamicEntry({
          namespace: "chrome_extension",
          tool: "get_tab_context",
          arguments: { tabId: 12 },
          status: "completed",
          completed: true,
        })}
      />,
    );

    expect(textContent(settings)).toBe("Reading settings");
    expect(textContent(chrome)).toBe("Read tab");
    expect(textContent(chrome).includes("Get Tab Context")).toBeFalse();
  });

  test("falls back when a known registry renderer rejects invalid arguments", () => {
    const { container } = render(
      <DynamicToolCall
        item={buildDynamicEntry({
          namespace: "chrome_extension",
          tool: "get_tab_context",
          arguments: { tabId: -1 },
          status: "completed",
          completed: true,
        })}
      />,
    );

    expect(textContent(container)).toBe("Get Tab Context");
  });

  test("renders generic dynamic tool fallback as a compact row without output or arguments", () => {
    const { container, queryByRole } = render(
      <DynamicToolCall
        item={buildDynamicEntry({
          namespace: "codex_app",
          tool: "load_workspace_dependencies",
          arguments: { includeLibraries: true },
          contentItems: [{ type: "inputText", text: "{\"node\":\"/tmp/node\"}" }],
        })}
      />,
    );

    expect(textContent(container)).toBe("Loaded workspace dependencies");
    expect(textContent(container).includes("includeLibraries")).toBeFalse();
    expect(textContent(container).includes("/tmp/node")).toBeFalse();
    expect(textContent(container).includes("Arguments")).toBeFalse();
    expect(Boolean(queryByRole("button"))).toBeFalse();
  });

  test("uses active fallback labels for in-progress generic dynamic tools", () => {
    const { container } = render(
      <DynamicToolCall
        item={buildDynamicEntry({
          tool: "automation_update",
          status: "inProgress",
          contentItems: null,
          success: null,
          durationMs: null,
          completed: false,
        })}
      />,
    );

    expect(textContent(container)).toBe("Updating scheduled task");
  });

  test("renders completed automation_update results as openable scheduled task cards", () => {
    const opened: string[] = [];
    const { container, getByRole } = renderWithQueryClient(
      <DynamicToolCall
        item={buildDynamicEntry({
          tool: "automation_update",
          arguments: {
            mode: "create",
            kind: "cron",
            status: "ACTIVE",
            name: "Release notes",
            prompt: "Review release notes.",
            rrule: "FREQ=DAILY;BYHOUR=9;BYMINUTE=0",
            cwds: ["/repo/nodex"],
            executionEnvironment: "worktree",
            localEnvironmentConfigPath: null,
            model: "gpt-5-codex",
            reasoningEffort: "medium",
          },
          contentItems: [
            { type: "inputText", text: "Created automation in the app." },
            { type: "inputText", text: "{\"automationId\":\"automation-release\",\"mode\":\"create\"}" },
          ],
        })}
        onOpenSummaryScheduledAutomation={(input) => {
          opened.push(`${input.automationId}:${input.title}`);
        }}
      />,
    );

    expect(textContent(container).includes("Release notes")).toBeTrue();
    expect(textContent(container).includes("Created")).toBeTrue();
    expect(textContent(container).includes("Daily")).toBeTrue();

    fireEvent.click(getByRole("button", { name: /Release notes/i }));

    expect(opened.join(",")).toBe("automation-release:Release notes");
  });

  test("opens suggested automation_update create cards as scheduled task side-panel proposals", () => {
    const opened: string[] = [];
    const item = {
      ...buildDynamicEntry({
        tool: "automation_update",
        arguments: {
          mode: "suggested_create",
          kind: "cron",
          status: "ACTIVE",
          name: "Review release notes",
          prompt: "Review release notes and summarize risks.",
          rrule: "FREQ=DAILY;BYHOUR=9;BYMINUTE=0",
          cwds: "/repo/nodex",
          executionEnvironment: "worktree",
          localEnvironmentConfigPath: null,
          model: "gpt-5-codex",
          reasoningEffort: "medium",
        },
      }),
      threadId: "thread-current",
    };
    const { container, getByRole } = renderWithQueryClient(
      <DynamicToolCall
        item={item}
        onOpenSummaryScheduledAutomation={(input) => {
          opened.push([
            input.mode,
            input.title,
            input.createInput?.kind,
            input.createInput?.name,
            input.createInput?.cwds?.join(","),
          ].join(":"));
        }}
      />,
    );

    expect(textContent(container).includes("Proposed")).toBeTrue();
    expect(textContent(container).includes("Open")).toBeTrue();
    expect(textContent(container).includes("Create scheduled task")).toBeFalse();
    expect(textContent(container).includes("Cancel")).toBeFalse();

    fireEvent.click(getByRole("button", { name: /Review release notes/i }));

    expect(opened.join(",")).toBe("suggested-create:Review release notes:cron:Review release notes:/repo/nodex");
  });
});
