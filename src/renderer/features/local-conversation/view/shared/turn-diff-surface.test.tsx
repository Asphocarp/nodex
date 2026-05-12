import { beforeEach, describe, expect, test } from "bun:test";
import { fireEvent, waitFor } from "@testing-library/react";
import {
  __resetNodexToastStoreForTests,
  NodexToastProvider,
} from "../../../../components/ui/toast";
import { NodexTooltipProvider as TooltipProvider } from "../../../../components/ui/tooltip";
import { installAsyncRequestAnimationFrame, installWindowApi } from "../../../../test/browser-globals";
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
    installAsyncRequestAnimationFrame();
    __resetNodexToastStoreForTests();
    installWindowApi({
      invoke: async () => true,
      on: () => () => { },
    });
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

    const summaryToggle = container.querySelectorAll<HTMLElement>('[role="button"][aria-expanded="false"]')[0] ?? null;
    expect(Boolean(summaryToggle)).toBeTrue();
    fireEvent.click(summaryToggle as HTMLElement);
    await settleAsyncRender();

    expect(container.querySelectorAll('[role="button"][aria-expanded="true"]').length).toBe(1);
    const expandedRow = container.querySelector<HTMLElement>('[role="button"][aria-expanded="true"]')?.parentElement ?? null;
    expect(Boolean(expandedRow)).toBeTrue();
    expect(expandedRow?.querySelectorAll("diffs-container").length ?? 0).toBe(1);
    const diffHost = expandedRow?.querySelector<HTMLElement>("diffs-container.nodex-inline-diff") ?? null;
    expect(Boolean(diffHost)).toBeTrue();
    await waitFor(() => {
      expect(Boolean(diffHost?.shadowRoot?.textContent?.includes("new"))).toBeTrue();
    });
  });

  test("shows the compact streaming banner above the composer without inline rows", () => {
    let reviewTargetPatch = "";
    const { container } = render(
      <TooltipProvider>
        <TurnDiffSurface
          item={buildTurnDiffEntry()}
          isInProgress={true}
          threadCwd="/tmp/project"
          onOpenReview={(target) => {
            reviewTargetPatch = target.patch;
          }}
        />
      </TooltipProvider>,
    );

    expect(Boolean(container.textContent?.includes("2 files changed"))).toBeTrue();
    expect(Boolean(container.textContent?.includes("Review"))).toBeTrue();
    expect(container.querySelectorAll('[role="button"][aria-expanded]').length).toBe(0);
    const liveSurface = container.querySelector<HTMLElement>('[codex\\.turn_diff\\.state="in_progress"]');
    expect(Boolean(liveSurface)).toBeTrue();
    expect(Boolean(liveSurface?.className.includes("bg-token-input-background/70"))).toBeTrue();
    expect(Boolean(liveSurface?.innerHTML.includes("@container"))).toBeTrue();
    expect(Boolean(liveSurface?.querySelector(".diff-stat-digit-column"))).toBeTrue();

    const reviewButton = container.querySelector('button[aria-label="Review changes"]');
    expect(Boolean(reviewButton)).toBeTrue();
    fireEvent.click(reviewButton as HTMLElement);
    expect(reviewTargetPatch.includes("src/one.ts")).toBeTrue();
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
          onOpenReview={() => {}}
        />
      </TooltipProvider>,
    );

    const summaryToggle = container.querySelectorAll<HTMLElement>('[role="button"][aria-expanded="false"]')[0] ?? null;
    expect(Boolean(summaryToggle)).toBeTrue();
    fireEvent.click(summaryToggle as HTMLElement);
    await settleAsyncRender();

    expect(Boolean(container.textContent?.includes("Too large to render inline"))).toBeTrue();
    expect(Boolean(container.textContent?.includes("Review changes"))).toBeTrue();
  });

  test("builds an explicit review target for the selected turn diff", () => {
    const target = turnDiffSurfaceTestHelpers.buildTurnDiffReviewTarget(
      buildTurnDiffEntry(),
      "/tmp/project",
      undefined,
    );

    expect(target?.type ?? null).toBe("turnDiff");
    expect(target?.threadId ?? null).toBe("thread-1");
    expect(target?.turnId ?? null).toBe("turn-1");
    expect(target?.cwd ?? null).toBe("/tmp/project");
  });

  test("toggles revert and reapply when showRevertButton is enabled", async () => {
    const invokeCalls: Array<[string, unknown]> = [];
    installWindowApi({
      invoke: async (channel: string, payload: unknown) => {
        invokeCalls.push([channel, payload]);
        if (channel === "git:apply-patch") {
          return {
            status: "success",
            appliedPaths: ["src/one.ts"],
            skippedPaths: [],
            conflictedPaths: [],
            errorCode: null,
            errorMessage: null,
          };
        }
        return true;
      },
      on: () => () => { },
    });

    const view = render(
      <NodexToastProvider>
        <TooltipProvider>
          <TurnDiffSurface
            item={buildTurnDiffEntry({
              rawItem: {
                type: "turn-diff",
                cwd: "/tmp/project",
                unifiedDiff: [
                  "--- a/src/one.ts",
                  "+++ b/src/one.ts",
                  "@@ -1 +1 @@",
                  "-old",
                  "+new",
                ].join("\n"),
                showRevertButton: true,
              },
            })}
            isInProgress={false}
            threadCwd="/tmp/project"
          />
        </TooltipProvider>
      </NodexToastProvider>,
    );

    const revertButton = view.container.querySelector('button[aria-label="Revert changes"]');
    expect(Boolean(revertButton)).toBeTrue();
    fireEvent.click(revertButton as HTMLElement);
    await settleAsyncRender();

    expect(invokeCalls[0]?.[0] ?? null).toBe("git:apply-patch");
    expect(Boolean(String(JSON.stringify(invokeCalls[0]?.[1] ?? {})).includes("\"revert\":true"))).toBeTrue();
    expect(Boolean(view.baseElement.textContent?.includes("Reverted thread changes."))).toBeTrue();

    const reapplyButton = view.container.querySelector('button[aria-label="Reapply changes"]');
    expect(Boolean(reapplyButton)).toBeTrue();
    fireEvent.click(reapplyButton as HTMLElement);
    await settleAsyncRender();

    expect(Boolean(String(JSON.stringify(invokeCalls[1]?.[1] ?? {})).includes("\"revert\":false"))).toBeTrue();
  });
});
