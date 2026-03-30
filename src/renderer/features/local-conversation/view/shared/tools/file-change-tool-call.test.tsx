import { beforeEach, describe, expect, test } from "bun:test";
import { fireEvent } from "@testing-library/react";
import { NodexTooltipProvider as TooltipProvider } from "../../../../../components/ui/tooltip";
import {
  installAsyncRequestAnimationFrame,
  installElementScrollHeight,
  installMeasuredResizeObserver,
  installWindowApi,
} from "../../../../../test/browser-globals";
import { render, settleAsyncRender, textContent } from "../../../../../test/dom";
import type { CodexTranscriptEntry } from "../../../../../lib/types";
import { FileChangeToolCall, fileChangeToolCallTestHelpers } from "./file-change-tool-call";

function buildFileChangeEntry(overrides?: Partial<CodexTranscriptEntry>): CodexTranscriptEntry {
  return {
    threadId: "thread-1",
    turnId: "turn-1",
    itemId: "tool-1",
    entryId: "tool-1",
    type: "file_change",
    kind: "fileChange",
    semanticKind: "patch",
    status: "completed",
    toolCall: {
      subtype: "fileChange",
      toolName: "file_change",
      args: {
        changes: [
          {
            path: "src/renderer/features/local-conversation/view/local-conversation-stage-screen.tsx",
            diff: [
              "@@ -1,5 +1,7 @@",
              " import { useState } from \"react\";",
              "+import { StoryShell } from \"./thread-stage-dev-story\";",
              " ",
              " export function LocalConversationStageScreen() {",
              "+  return <StoryShell />;",
              " }",
            ].join("\n"),
          },
        ],
      },
      result: {
        diff: [
          "--- a/src/renderer/features/local-conversation/view/local-conversation-stage-screen.tsx",
          "+++ b/src/renderer/features/local-conversation/view/local-conversation-stage-screen.tsx",
          "@@ -1,5 +1,7 @@",
          " import { useState } from \"react\";",
          "+import { StoryShell } from \"./thread-stage-dev-story\";",
          " ",
          " export function LocalConversationStageScreen() {",
          "+  return <StoryShell />;",
          " }",
        ].join("\n"),
      },
    },
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
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

  test("resolves the Codex-style open-file target and keeps filename clicks from toggling the row", async () => {
    const rows = fileChangeToolCallTestHelpers.buildFileChangeRows(
      buildFileChangeEntry(),
      "/tmp/project",
      undefined,
    );
    expect(rows.length).toBe(1);
    expect(rows[0]?.openPath ?? null).toBe("/tmp/project/src/renderer/features/local-conversation/view/local-conversation-stage-screen.tsx");
    expect(rows[0]?.openLine ?? null).toBe(1);

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
    const rows = fileChangeToolCallTestHelpers.buildFileChangeRows(
      buildFileChangeEntry({
        toolCall: {
          subtype: "fileChange",
          toolName: "file_change",
          args: {},
          result: {
            diff: [
              "--- a/src/renderer/features/local-conversation/view/local-conversation-stage-screen.tsx",
              "+++ b/src/renderer/features/local-conversation/view/local-conversation-stage-screen.tsx",
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
    const multiFileEntry = buildFileChangeEntry({
      toolCall: {
        subtype: "fileChange",
        toolName: "file_change",
        args: {
          changes: [
            {
              path: "src/one.ts",
              diff: [
                "@@ -1 +1 @@",
                "-console.log('one');",
                "+console.log('ONE');",
              ].join("\n"),
            },
            {
              path: "src/two.ts",
              diff: [
                "@@ -1 +1 @@",
                "-console.log('two');",
                "+console.log('TWO');",
              ].join("\n"),
            },
          ],
        },
        result: {
          diff: [
            "--- a/src/one.ts",
            "+++ b/src/one.ts",
            "@@ -1 +1 @@",
            "-console.log('one');",
            "+console.log('ONE');",
            "--- a/src/two.ts",
            "+++ b/src/two.ts",
            "@@ -1 +1 @@",
            "-console.log('two');",
            "+console.log('TWO');",
          ].join("\n"),
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

    fireEvent.click(toggles[0]!);
    await settleAsyncRender();

    expect(container.querySelectorAll('[role="button"][aria-expanded="true"]').length).toBe(1);
    expect(Boolean(textContent(container).includes("Edited file"))).toBeTrue();
  });

  test("keeps the patch body on explicit pixel height instead of switching to auto", async () => {
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

    const body = container.querySelector<HTMLElement>('[data-patch-row-body]');
    expect(Boolean(body)).toBeTrue();
    expect(body?.style.height === "auto").toBeFalse();
  });
});
