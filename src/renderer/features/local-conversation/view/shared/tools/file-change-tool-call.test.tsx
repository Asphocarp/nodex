import { beforeEach, describe, expect, test } from "bun:test";
import { fireEvent, waitFor } from "@testing-library/react";
import { NodexTooltipProvider as TooltipProvider } from "../../../../../components/ui/tooltip";
import {
  installAsyncRequestAnimationFrame,
  installElementScrollHeight,
  installMeasuredResizeObserver,
  installWindowApi,
} from "../../../../../test/browser-globals";
import { render, settleAsyncRender, textContent } from "../../../../../test/dom";
import type { CodexFileChange, CodexFileChangeView, CodexTranscriptEntry } from "../../../../../lib/types";
import { normalizeThreadItem } from "../../../../../../main/codex/codex-item-normalizer";
import { buildCodexFileChangeUnifiedDiff } from "../../../../../../shared/codex-file-change";
import { FileChangeToolCall, fileChangeToolCallTestHelpers } from "./file-change-tool-call";

function buildFileChangeView(changes: CodexFileChange[]): CodexFileChangeView {
  return {
    label: undefined,
    paths: changes.map((change) => change.path),
    changes,
    diffs: changes
      .map((change) => buildCodexFileChangeUnifiedDiff(change))
      .filter((diff): diff is string => typeof diff === "string"),
  };
}

function buildFileChangeLabel(change: CodexFileChange | undefined): string | undefined {
  if (!change) return undefined;
  return `${change.type === "add" ? "Created" : change.type === "delete" ? "Deleted" : "Edited"} ${change.path}`;
}

function buildFileChangeEntry(overrides?: Partial<CodexTranscriptEntry>): CodexTranscriptEntry {
  const defaultChanges: CodexFileChange[] = [
    {
      path: "src/renderer/features/local-conversation/view/local-conversation-stage-screen.tsx",
      type: "update",
      movePath: "src/renderer/features/local-conversation/view/thread-stage-screen.tsx",
      unifiedDiff: [
        "@@ -1,5 +1,7 @@",
        " import { useState } from \"react\";",
        "+import { StoryShell } from \"./thread-stage-dev-story\";",
        " ",
        " export function LocalConversationStageScreen() {",
        "+  return <StoryShell />;",
        " }",
      ].join("\n"),
    },
  ];
  const fileChange = overrides?.fileChange ?? buildFileChangeView(defaultChanges);
  const label = fileChange.label ?? buildFileChangeLabel(fileChange.changes[0]);

  return {
    threadId: "thread-1",
    turnId: "turn-1",
    itemId: "tool-1",
    entryId: "tool-1",
    type: "file_change",
    kind: "fileChange",
    status: "completed",
    toolCall: {
      subtype: "fileChange",
      toolName: "file_change",
      args: {
        label,
      },
      result: {
        diffs: fileChange.diffs,
      },
    },
    fileChange,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function buildNormalizedFileChangeEntry(input: {
  status?: string;
  changes: Array<{
    path: string;
    kind: { type: "add" | "delete" } | { type: "update"; move_path: string | null };
    diff: string;
  }>;
}): CodexTranscriptEntry {
  const item = normalizeThreadItem(
    {
      id: "item-file-change",
      type: "fileChange",
      status: input.status ?? "completed",
      changes: input.changes,
    },
    "thread-1",
    "turn-1",
  );
  if (!item) throw new Error("Expected normalized file change entry");
  return {
    threadId: item.threadId,
    turnId: item.turnId,
    entryId: item.itemId,
    itemId: item.itemId,
    type: item.type,
    kind: item.normalizedKind,
    semanticKind: item.semanticKind,
    assistantPhase: item.assistantPhase,
    timeLabel: item.timeLabel,
    status: item.status,
    role: item.role,
    toolCall: item.toolCall,
    fileChange: item.fileChange,
    markdownText: item.markdownText,
    additionalDetails: item.additionalDetails,
    willRetry: item.willRetry,
    userInputQuestions: item.userInputQuestions,
    userInputAnswers: item.userInputAnswers,
    rawItem: item.rawItem,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

describe("FileChangeToolCall", () => {
  beforeEach(() => {
    installElementScrollHeight(96);
    installAsyncRequestAnimationFrame();
    installMeasuredResizeObserver({ blockSize: 96, inlineSize: 320 });
    installWindowApi({
      invoke: async () => true,
      on: () => () => { },
    });
  });

  test("expands into an inline diff frame with the Codex-style inner header", async () => {
    const { container } = render(
      <TooltipProvider>
        <FileChangeToolCall
          item={buildFileChangeEntry()}
          threadCwd="/tmp/project"
        />
      </TooltipProvider>,
    );

    const summaryToggle = container.querySelector('[role="button"][aria-expanded="false"]');
    expect(Boolean(summaryToggle)).toBeTrue();

    fireEvent.click(summaryToggle as HTMLElement);
    await settleAsyncRender();

    const expandedToggle = container.querySelector('[role="button"][aria-expanded="true"]');
    expect(Boolean(expandedToggle)).toBeTrue();
    expect(Boolean(container.textContent?.includes("Edited file"))).toBeTrue();
    expect(Boolean(container.textContent?.includes("local-conversation-stage-screen.tsx"))).toBeTrue();
    expect(Boolean(container.textContent?.includes("+2"))).toBeTrue();
    expect(Boolean(container.textContent?.includes("-0"))).toBeTrue();
    expect(Boolean(container.querySelector('button[aria-label="Copy diff"]'))).toBeTrue();
  });

  test("renders live file-change stats with the animated digit wheel", () => {
    const { container } = render(
      <TooltipProvider>
        <FileChangeToolCall
          item={buildFileChangeEntry({ status: "inProgress" })}
          threadCwd="/tmp/project"
        />
      </TooltipProvider>,
    );

    expect(Boolean(container.querySelector(".diff-stat-digit-column"))).toBeTrue();
    expect(Boolean(container.querySelector(".diff-stat-digit-stack-2"))).toBeTrue();
    expect(Boolean(container.querySelector("[data-tool-activity-icon='edit-files']"))).toBeTrue();
  });

  test("resolves the Codex-style open-file target and keeps filename clicks from toggling the row", async () => {
    const rows = fileChangeToolCallTestHelpers.buildFileChangeRows(
      buildFileChangeEntry(),
      "/tmp/project",
      undefined,
    );
    expect(rows.length).toBe(1);
    const firstRow = rows[0];
    expect(firstRow?.openPath ?? null).toBe("/tmp/project/src/renderer/features/local-conversation/view/local-conversation-stage-screen.tsx");
    expect(firstRow && firstRow.preview.kind === "diff" ? firstRow.preview.openLine ?? null : null).toBe(1);

    const { container } = render(
      <TooltipProvider>
        <FileChangeToolCall
          item={buildFileChangeEntry()}
          threadCwd="/tmp/project"
        />
      </TooltipProvider>,
    );

    const filenameButton = container.querySelector('button[data-state="closed"].max-w-full');
    expect(Boolean(filenameButton)).toBeTrue();
    fireEvent.click(filenameButton as HTMLElement);
    await settleAsyncRender();

    expect(Boolean(container.querySelector('[role="button"][aria-expanded="true"]'))).toBeFalse();
  });

  test("derives parsed file diff stats from actual changed lines", () => {
    const changes: CodexFileChange[] = [
      {
        path: "src/renderer/features/local-conversation/view/local-conversation-stage-screen.tsx",
        type: "update",
        movePath: null,
        unifiedDiff: [
          "@@ -3,11 +3,12 @@",
          " import { LocalConversationFooter } from \"./local-conversation-footer\";",
          " import { ThreadStageHeader } from \"./local-conversation-stage-header\";",
          " import { LocalConversationThreadBody } from \"./local-conversation-thread-body\";",
          "+import { StoryShell } from \"./thread-stage-dev-story\";",
          " ",
          " export function LocalConversationStageScreen({ model, actions, initialUiState }: ThreadStageScreenProps) {",
          "   const [errorMessage, setErrorMessage] = useState<string | null>(null);",
          " ",
          "   return (",
          "-    <div className=\"flex h-full min-h-0 flex-col bg-(--background)\">",
          "+    <StoryShell className=\"flex h-full min-h-0 flex-col bg-(--background)\">",
          "       <ThreadStageHeader model={model} actions={actions} onErrorMessage={setErrorMessage} />",
          "       <LocalConversationThreadBody",
          "@@ -22,6 +23,6 @@",
          "         errorMessage={errorMessage}",
          "         onErrorMessage={setErrorMessage}",
          "       />",
          "-    </div>",
          "+    </StoryShell>",
          "   );",
          " }",
        ].join("\n"),
      },
    ];
    const fileChange = buildFileChangeView(changes);

    const rows = fileChangeToolCallTestHelpers.buildFileChangeRows(
      buildFileChangeEntry({
        fileChange,
        toolCall: {
          subtype: "fileChange",
          toolName: "file_change",
          args: {
            label: buildFileChangeLabel(changes[0]),
          },
          result: {
            diffs: fileChange.diffs,
          },
        },
      }),
      "/tmp/project",
      undefined,
    );

    expect(rows.length).toBe(1);
    expect(rows[0]?.summary.additions ?? null).toBe(3);
    expect(rows[0]?.summary.deletions ?? null).toBe(2);
  });

  test("toggles multi-file rows independently", async () => {
    const changes: CodexFileChange[] = [
      {
        path: "src/one.ts",
        type: "update",
        movePath: null,
        unifiedDiff: [
          "@@ -1 +1 @@",
          "-console.log('one');",
          "+console.log('ONE');",
        ].join("\n"),
      },
      {
        path: "src/two.ts",
        type: "update",
        movePath: null,
        unifiedDiff: [
          "@@ -1 +1 @@",
          "-console.log('two');",
          "+console.log('TWO');",
        ].join("\n"),
      },
    ];
    const fileChange = buildFileChangeView(changes);

    const multiFileEntry = buildFileChangeEntry({
      fileChange,
      toolCall: {
        subtype: "fileChange",
        toolName: "file_change",
        args: {
          label: undefined,
        },
        result: {
          diffs: fileChange.diffs,
        },
      },
    });

    const { container } = render(
      <TooltipProvider>
        <FileChangeToolCall item={multiFileEntry} threadCwd="/tmp/project" />
      </TooltipProvider>,
    );

    const toggles = Array.from(container.querySelectorAll<HTMLElement>('[role="button"][aria-expanded="false"]'));
    expect(toggles.length).toBe(2);

    await waitFor(() => {
      expect(toggles[0]?.getAttribute("aria-expanded")).toBe("false");
    });
    fireEvent.click(toggles[0]!);

    await waitFor(() => {
      expect(container.querySelectorAll('[role="button"][aria-expanded="true"]').length).toBe(1);
    });
    expect(Boolean(textContent(container).includes("Edited file"))).toBeTrue();

    const diffHost = container.querySelector<HTMLElement>(".nodex-inline-diff");
    expect(Boolean(diffHost)).toBeTrue();
    expect(Boolean(diffHost?.shadowRoot?.querySelector("[data-diffs-header]"))).toBeFalse();
  });

  test("keeps the file-change body on explicit pixel height instead of switching to auto", async () => {
    const { container } = render(
      <TooltipProvider>
        <FileChangeToolCall
          item={buildFileChangeEntry()}
          threadCwd="/tmp/project"
        />
      </TooltipProvider>,
    );

    const summaryToggle = container.querySelector('[role="button"][aria-expanded="false"]');
    expect(Boolean(summaryToggle)).toBeTrue();

    fireEvent.click(summaryToggle as HTMLElement);
    await settleAsyncRender();

    const body = container.querySelector<HTMLElement>('[data-file-change-row-body]');
    expect(Boolean(body)).toBeTrue();
    expect(body?.style.height === "auto").toBeFalse();
  });

  test("renders created files from v2 protocol changes as inline diffs", async () => {
    const item = buildNormalizedFileChangeEntry({
      changes: [
        {
          path: "src/local-conversation-resume-loader.tsx",
          kind: { type: "add" },
          diff: [
            "import { NodexLogoMarkIcon } from \"@/components/shared/icons\";",
            "",
            "const NODEX_LOGO_MASK_IMAGE = 'url(data:image/svg+xml,%3Csvg/...)';",
            "",
            "export function LocalConversationResumeLoader() {",
            "  return <NodexLogoMarkIcon />;",
            "}",
          ].join("\n"),
        },
      ],
    });

    const rows = fileChangeToolCallTestHelpers.buildFileChangeRows(item, "/tmp/project", undefined);
    expect(rows.length).toBe(1);
    expect(rows[0]?.summary.additions ?? null).toBe(7);
    expect(rows[0]?.summary.deletions ?? null).toBe(0);

    const { container } = render(
      <TooltipProvider>
        <FileChangeToolCall item={item} threadCwd="/tmp/project" />
      </TooltipProvider>,
    );

    const summaryToggle = container.querySelector('[role="button"][aria-expanded="false"]');
    expect(Boolean(summaryToggle)).toBeTrue();
    expect(Boolean(textContent(container).includes("Created"))).toBeTrue();
    expect(Boolean(textContent(container).includes("+7"))).toBeTrue();

    fireEvent.click(summaryToggle as HTMLElement);
    await settleAsyncRender();

    expect(Boolean(textContent(container).includes("Created file"))).toBeTrue();
    expect(Boolean(textContent(container).includes("local-conversation-resume-loader.tsx"))).toBeTrue();
    const diffHost = container.querySelector<HTMLElement>(".nodex-inline-diff");
    expect(Boolean(diffHost)).toBeTrue();
    await waitFor(() => {
      expect(Boolean(diffHost?.shadowRoot?.textContent?.includes("NodexLogoMarkIcon"))).toBeTrue();
    });
  });

  test("never falls back to raw patch text", async () => {
    const changes: CodexFileChange[] = [
      {
        path: "src/new-file.ts",
        type: "add",
        content: "export function Foo() {}\n",
      },
      {
        path: "src/deleted-file.ts",
        type: "delete",
        content: "export function Gone() {}\n",
      },
    ];
    const fileChange = buildFileChangeView(changes);

    const { container } = render(
      <TooltipProvider>
        <FileChangeToolCall
          item={buildFileChangeEntry({
            fileChange,
            toolCall: {
              subtype: "fileChange",
              toolName: "file_change",
              args: {
                label: undefined,
              },
              result: { diffs: fileChange.diffs },
            },
          })}
          threadCwd="/tmp/project"
        />
      </TooltipProvider>,
    );

    const summaryToggle = container.querySelector('[role="button"][aria-expanded="false"]');
    expect(Boolean(summaryToggle)).toBeTrue();

    fireEvent.click(summaryToggle as HTMLElement);
    await settleAsyncRender();

    expect(Boolean(textContent(container).includes("*** Begin Patch"))).toBeFalse();
    expect(Boolean(container.querySelector('button[aria-label="Copy diff"]'))).toBeTrue();
  });

  test("renders declined file changes with rejected status copy", async () => {
    const changes: CodexFileChange[] = [
      {
        path: "src/new-file.ts",
        type: "add",
        content: "export const created = true;\n",
      },
    ];
    const fileChange = buildFileChangeView(changes);

    const { container } = render(
      <TooltipProvider>
        <FileChangeToolCall
          item={buildFileChangeEntry({
            status: "declined",
            fileChange,
            toolCall: {
              subtype: "fileChange",
              toolName: "file_change",
              args: {
                label: buildFileChangeLabel(changes[0]),
              },
              result: { diffs: fileChange.diffs },
            },
          })}
          threadCwd="/tmp/project"
        />
      </TooltipProvider>,
    );

    expect(Boolean(textContent(container).includes("Rejected"))).toBeTrue();

    const summaryToggle = container.querySelector('[role="button"][aria-expanded="false"]');
    expect(Boolean(summaryToggle)).toBeTrue();

    fireEvent.click(summaryToggle as HTMLElement);
    await settleAsyncRender();

    expect(Boolean(textContent(container).includes("Created file"))).toBeFalse();
  });

  test("renders failed file changes with rejected status copy", () => {
    const changes: CodexFileChange[] = [
      {
        path: "src/new-file.ts",
        type: "add",
        content: "export const created = true;\n",
      },
    ];
    const fileChange = buildFileChangeView(changes);

    const rows = fileChangeToolCallTestHelpers.buildFileChangeRows(
      buildFileChangeEntry({
        status: "failed",
        fileChange,
        toolCall: {
          subtype: "fileChange",
          toolName: "file_change",
          args: {
            label: buildFileChangeLabel(changes[0]),
          },
          result: { diffs: fileChange.diffs },
        },
      }),
      "/tmp/project",
      undefined,
    );

    expect(rows[0]?.label ?? null).toBe("Rejected");
    expect(rows[0]?.expandedLabel ?? null).toBe(null);
  });
});
