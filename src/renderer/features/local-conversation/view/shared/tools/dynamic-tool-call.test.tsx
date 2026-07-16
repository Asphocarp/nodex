import { describe, expect, test } from "vitest";
import { act, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { NodexTooltipProvider as TooltipProvider } from "../../../../../components/ui/tooltip";
import type { CodexTranscriptEntry } from "../../../../../lib/types";
import { render, textContent } from "../../../../../test/dom";
import { DynamicToolCall } from "./dynamic-tool-call";

function activityText(container: HTMLElement): string {
  const shimmer = container.querySelector(".loading-shimmer-pure-text");
  return shimmer?.firstChild?.textContent ?? textContent(container);
}

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
    rawItem: {
      type: "dynamicToolCall",
      id: dynamicToolCall.callId,
      namespace: dynamicToolCall.namespace,
      tool: dynamicToolCall.tool,
      arguments: dynamicToolCall.arguments,
      status: dynamicToolCall.status ?? "completed",
      contentItems: dynamicToolCall.contentItems ?? null,
      success: dynamicToolCall.success ?? null,
      durationMs: dynamicToolCall.durationMs ?? null,
    },
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
  test("renders Codex app meta thread calls as compact rows with collapsed details", () => {
    const { container, getByRole } = render(<DynamicToolCall item={buildDynamicEntry()} />);

    expect(textContent(container).includes("Read task")).toBe(true);
    expect(textContent(container).includes("schemaVersion")).toBe(false);
    expect(textContent(container).includes("Arguments")).toBe(false);
    expect(
      getByRole("button", { name: "Show codex_app.read_thread tool call details" })
        .getAttribute("aria-expanded"),
    ).toBe("false");
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

    fireEvent.click(getByRole("button", { name: "Read task" }));

    expect(openedThreads.join(",")).toBe("thread-1");
  });

  test("renders completed create_thread success as an open-task card", async () => {
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

    expect(textContent(container).includes("Task created")).toBe(true);
    expect(textContent(container).includes("Open task")).toBe(true);
    expect(getByRole("button", { name: "Open task" }).getAttribute("aria-label")).toBe("Open task");

    await act(async () => {
      fireEvent.click(getByRole("button", { name: "Open task" }));
      await Promise.resolve();
    });

    expect(openedThreads.join(",")).toBe("thread-created");
  });

  test("opens create_thread client results through normal thread navigation", async () => {
      const openedThreads: string[] = [];
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
            contentItems: [{
              type: "inputText",
              text: "{\"clientThreadId\":\"client-new-thread:11111111-1111-4111-8111-111111111111\"}",
            }],
          })}
          onOpenThread={(threadId) => {
            openedThreads.push(threadId);
          }}
        />,
      );

      expect(textContent(container).includes("Worktree task queued")).toBe(true);
      expect(textContent(container).includes("Open setup")).toBe(true);
      expect(getByRole("button", { name: "Open worktree setup" }).getAttribute("aria-label")).toBe("Open worktree setup");

      await act(async () => {
        fireEvent.click(getByRole("button", { name: "Open worktree setup" }));
        await Promise.resolve();
      });

      expect(openedThreads.join(",")).toBe(
        "client-new-thread:11111111-1111-4111-8111-111111111111",
      );
  });

  test("does not materialize legacy create_thread pendingWorktreeId output as a card", () => {
    const { container, getByRole, queryByRole } = render(
      <DynamicToolCall
        item={buildDynamicEntry({
          tool: "create_thread",
          arguments: {
            prompt: "Continue in a worktree task",
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

    expect(textContent(container).includes("Created worktree task")).toBe(true);
    expect(queryByRole("button", { name: "Open worktree setup" })).toBe(null);
    expect(getByRole("button", { name: /tool call details/i })).toBeTruthy();
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

    expect(getByRole("button", { name: /Handing off task/i }).getAttribute("aria-expanded")).toBe("true");
    expect(textContent(container).includes("Resolve thread")).toBe(true);
    expect(textContent(container).includes("Move thread")).toBe(true);
    expect(textContent(container).includes("Arguments")).toBe(false);
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

    expect(activityText(settings)).toBe("Reading settings");
    expect(textContent(chrome).includes("Read tab")).toBe(true);
    expect(textContent(chrome).includes("Get Tab Context")).toBe(false);
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

    expect(textContent(container).includes("Get Tab Context")).toBe(true);
  });

  test("expands generic Nodex calls into arguments, canonical output, and exact raw protocol data", async () => {
    const item = buildDynamicEntry({
      namespace: "nodex_app",
      tool: "edit_document",
      arguments: {
        documentId: "document-1",
        ifRevision: "rev-card-1",
        body: {
          kind: "nfm.insert",
          at: { kind: "end" },
          content: "## Launch checklist\n- [ ] Verify migration",
        },
      },
      contentItems: [{
        type: "inputText",
        text: JSON.stringify({
          schemaVersion: 1,
          data: {
            documentId: "document-1",
            revision: "rev-card-2",
            effects: {
              createdBlockIds: ["heading-1", "task-1"],
              localBlockIds: {},
              copiedBlockIds: {},
              updatedBlockIds: [],
              movedBlockIds: [],
              deletedBlockIds: [],
            },
            body: { contentOmitted: true },
            receipt: { duplicate: false },
          },
        }),
      }],
      success: true,
      durationMs: 37,
    });
    const { container, getByRole } = render(
      <TooltipProvider>
        <DynamicToolCall item={item} />
      </TooltipProvider>,
    );

    expect(textContent(container).includes("Edited document · NFM insertion")).toBe(true);
    expect(textContent(container).includes("Launch checklist")).toBe(true);
    expect(textContent(container).includes("NFM insertion")).toBe(true);
    expect(textContent(container).includes("+2")).toBe(true);
    expect(textContent(container).includes("Arguments")).toBe(false);

    await act(async () => {
      fireEvent.click(getByRole("button", { name: "Show nodex_app.edit_document tool call details" }));
      await Promise.resolve();
    });

    expect(textContent(container).includes("Arguments")).toBe(true);
    expect(textContent(container).includes("Launch checklist")).toBe(true);
    expect(textContent(container).includes("Output · json")).toBe(true);
    expect(textContent(container).includes("heading-1")).toBe(true);
    expect(textContent(container).includes("completed · 37 ms")).toBe(true);

    await act(async () => {
      fireEvent.click(getByRole("button", { name: "Show raw nodex_app.edit_document tool call" }));
      await Promise.resolve();
    });

    const dialog = getByRole("dialog");
    expect(textContent(dialog).includes("Raw nodex_app.edit_document tool call")).toBe(true);
    expect(textContent(dialog).includes('"type": "dynamicToolCall"')).toBe(true);
    expect(textContent(dialog).includes('"id": "dynamic-1"')).toBe(true);
    expect(textContent(dialog).includes('"durationMs": 37')).toBe(true);
  });

  test("shows both sides of an NFM patch before the details inspector is opened", () => {
    const { container, getByRole } = render(
      <DynamicToolCall
        item={buildDynamicEntry({
          namespace: "nodex_app",
          tool: "edit_document",
          arguments: {
            documentId: "document-1",
            ifRevision: "revision-1",
            body: {
              kind: "nfm.patch",
              patches: [{
                oldNfm: "## Draft\n- [ ] Verify migration",
                newNfm: "## Ready\n- [x] Verify migration",
              }],
            },
          },
        })}
      />,
    );

    expect(textContent(container).includes("## Draft")).toBe(true);
    expect(textContent(container).includes("## Ready")).toBe(true);
    expect(textContent(container).includes("−2")).toBe(true);
    expect(textContent(container).includes("+2")).toBe(true);
    expect(textContent(container).includes("Arguments")).toBe(false);
    expect(
      getByRole("button", { name: "Show nodex_app.edit_document tool call details" })
        .getAttribute("aria-expanded"),
    ).toBe("false");
  });

  test("shows a v3 Nested Markdown diff compactly while keeping exact arguments and raw output inspectable", async () => {
    const item = buildDynamicEntry({
      namespace: "nodex_app",
      tool: "update_page",
      arguments: {
        pageId: "page-launch",
        body: {
          kind: "patch",
          patches: [{
            oldMarkdown: "Status: Draft",
            newMarkdown: "Status: Ready",
          }],
        },
      },
      contentItems: [{
        type: "inputText",
        text: JSON.stringify({
          data: {
            pageId: "page-launch",
            effects: { created: 0, updated: 1, moved: 0, deleted: 0 },
          },
        }),
      }],
      success: true,
      durationMs: 18,
    });
    const { container, getByRole } = render(
      <TooltipProvider>
        <DynamicToolCall item={item} />
      </TooltipProvider>,
    );

    expect(textContent(container).includes(
      "Updated page “page-launch” · 1 Nested Markdown patch",
    )).toBe(true);
    expect(textContent(container).includes("Status: Draft")).toBe(true);
    expect(textContent(container).includes("Status: Ready")).toBe(true);
    expect(textContent(container).includes("Arguments")).toBe(false);

    await act(async () => {
      fireEvent.click(getByRole("button", {
        name: "Show nodex_app.update_page tool call details",
      }));
      await Promise.resolve();
    });
    expect(textContent(container).includes("Arguments")).toBe(true);
    expect(textContent(container).includes("Output · json")).toBe(true);

    await act(async () => {
      fireEvent.click(getByRole("button", {
        name: "Show raw nodex_app.update_page tool call",
      }));
      await Promise.resolve();
    });
    expect(textContent(getByRole("dialog")).includes('"oldMarkdown": "Status: Draft"')).toBe(true);
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

    expect(activityText(container)).toBe("Updating scheduled task");
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

    expect(textContent(container).includes("Release notes")).toBe(true);
    expect(textContent(container).includes("Created")).toBe(true);
    expect(textContent(container).includes("Daily")).toBe(true);

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

    expect(textContent(container).includes("Proposed")).toBe(true);
    expect(textContent(container).includes("Open")).toBe(true);
    expect(textContent(container).includes("Create scheduled task")).toBe(false);
    expect(textContent(container).includes("Cancel")).toBe(false);

    fireEvent.click(getByRole("button", { name: /Review release notes/i }));

    expect(opened.join(",")).toBe("suggested-create:Review release notes:cron:Review release notes:/repo/nodex");
  });
});
