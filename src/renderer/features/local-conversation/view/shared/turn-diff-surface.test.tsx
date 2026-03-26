import { beforeEach, describe, expect, test } from "bun:test";
import { fireEvent } from "@testing-library/react";
import { TooltipProvider } from "../../../../components/ui/tooltip";
import { render, settleAsyncRender } from "../../../../test/dom";
import type { CodexTranscriptEntry } from "../../../../lib/types";
import { TurnDiffSurface, turnDiffSurfaceTestHelpers } from "./turn-diff-surface";

function buildTurnDiffEntry(overrides?: Partial<CodexTranscriptEntry>): CodexTranscriptEntry {
  return {
    threadId: "thread-1",
    turnId: "turn-1",
    itemId: "turn-diff-1",
    entryId: "turn-diff-1",
    type: "turn_diff",
    kind: "systemEvent",
    semanticKind: "diff",
    status: "completed",
    rawItem: {
      type: "turn-diff",
      cwd: "/tmp/project",
      unifiedDiff: [
        "--- a/src/one.ts",
        "+++ b/src/one.ts",
        "@@ -1 +1 @@",
        "-old",
        "+new",
        "--- a/src/two.ts",
        "+++ b/src/two.ts",
        "@@ -1 +1 @@",
        "-old2",
        "+new2",
      ].join("\n"),
    },
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function buildSpanHeavyTurnDiffEntry(): CodexTranscriptEntry {
  return buildTurnDiffEntry({
    rawItem: {
      type: "turn-diff",
      cwd: "/tmp/project",
      unifiedDiff: [
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
  });
}

describe("TurnDiffSurface", () => {
  beforeEach(() => {
    globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    }) as typeof globalThis.requestAnimationFrame;

    (window as { api?: unknown }).api = {
      invoke: async () => true,
      on: () => () => {},
    };
  });

  test("renders a Codex-style files-changed card with collapsed per-file rows", () => {
    const { container } = render(
      <TooltipProvider>
        <TurnDiffSurface
          item={buildTurnDiffEntry()}
          isInProgress={false}
          threadCwd="/tmp/project"
        />
      </TooltipProvider>,
    );

    expect(Boolean(container.textContent?.includes("2 files changed"))).toBeTrue();
    expect(Boolean(container.textContent?.includes("+2"))).toBeTrue();
    expect(Boolean(container.textContent?.includes("-2"))).toBeTrue();
    expect(container.querySelectorAll('[role="button"][aria-expanded="false"]').length).toBe(2);
  });

  test("opens file rows inline and keeps filename clicks from toggling the row", async () => {
    const rows = turnDiffSurfaceTestHelpers.buildTurnDiffRows(buildTurnDiffEntry(), "/tmp/project", undefined);
    expect(rows.length).toBe(2);
    expect(rows[0]?.openPath ?? null).toBe("/tmp/project/src/one.ts");
    expect(rows[0]?.openLine ?? null).toBe(1);

    const { container } = render(
      <TooltipProvider>
        <TurnDiffSurface
          item={buildTurnDiffEntry()}
          isInProgress={false}
          threadCwd="/tmp/project"
        />
      </TooltipProvider>,
    );

    const filenameButton = container.querySelector('button[data-state="closed"]');
    expect(Boolean(filenameButton)).toBeTrue();
    fireEvent.click(filenameButton as HTMLElement);
    await settleAsyncRender();

    expect(container.querySelectorAll('[role="button"][aria-expanded="true"]').length).toBe(0);

    const summaryToggle = container.querySelector('[role="button"][aria-expanded="false"]');
    expect(Boolean(summaryToggle)).toBeTrue();
    fireEvent.click(summaryToggle as HTMLElement);
    await settleAsyncRender();

    expect(container.querySelectorAll('[role="button"][aria-expanded="true"]').length).toBe(1);
    expect(Boolean(container.querySelector(".nodex-inline-diff"))).toBeTrue();
  });

  test("shows the compact streaming banner above the composer without inline rows", () => {
    const { container } = render(
      <TooltipProvider>
        <TurnDiffSurface
          item={buildTurnDiffEntry()}
          isInProgress={true}
          threadCwd="/tmp/project"
        />
      </TooltipProvider>,
    );

    expect(Boolean(container.textContent?.includes("2 files changed"))).toBeTrue();
    expect(Boolean(container.textContent?.includes("Review"))).toBeTrue();
    expect(container.querySelectorAll('[role="button"][aria-expanded]').length).toBe(0);
  });

  test("derives per-file stats from actual changed lines instead of hunk span counts", () => {
    const rows = turnDiffSurfaceTestHelpers.buildTurnDiffRows(buildSpanHeavyTurnDiffEntry(), "/tmp/project", undefined);
    expect(rows.length).toBe(1);
    expect(rows[0]?.additions ?? null).toBe(3);
    expect(rows[0]?.deletions ?? null).toBe(2);
  });

  test("falls back when a file diff is too large to render inline", async () => {
    const largeDiff = [
      "--- a/src/huge.ts",
      "+++ b/src/huge.ts",
      "@@ -1,5001 +1,5001 @@",
      ...Array.from({ length: 5001 }, (_, index) => `-${index}`),
      ...Array.from({ length: 5001 }, (_, index) => `+${index}`),
    ].join("\n");

    const { container } = render(
      <TooltipProvider>
        <TurnDiffSurface
          item={buildTurnDiffEntry({
            rawItem: {
              type: "turn-diff",
              cwd: "/tmp/project",
              unifiedDiff: largeDiff,
            },
          })}
          isInProgress={false}
          threadCwd="/tmp/project"
        />
      </TooltipProvider>,
    );

    const summaryToggle = container.querySelector('[role="button"][aria-expanded="false"]');
    expect(Boolean(summaryToggle)).toBeTrue();
    fireEvent.click(summaryToggle as HTMLElement);
    await settleAsyncRender();

    expect(Boolean(container.textContent?.includes("Too large to render inline"))).toBeTrue();
  });
});
