import { describe, expect, test } from "vitest";
import { fireEvent } from "@testing-library/react";
import { NodexTooltipProvider as TooltipProvider } from "@/components/ui/tooltip";
import type { CodexConversationItem } from "../../../lib/types";
import { render, settleAsyncRender, textContent } from "../../../test/dom";
import type { ThreadTranscriptBlockModel } from "../thread-stage-types";
import {
  LocalConversationAboveComposerPortal,
  LocalConversationAboveComposerPortalHost,
} from "./local-conversation-above-composer-portal";

function buildTurnDiffBlock(): ThreadTranscriptBlockModel {
  const entry: CodexConversationItem = {
    threadId: "thread-portal",
    turnId: "turn-1",
    itemId: "turn-diff-live",
    entryId: "turn-diff-live",
    type: "turn_diff",
    kind: "systemEvent",
    semanticKind: "diff",
    status: "inProgress",
    rawItem: {
      type: "turn-diff",
      cwd: "/tmp/project",
      unifiedDiff: [
        "--- a/src/app.ts",
        "+++ b/src/app.ts",
        "@@ -1 +1 @@",
        "-old",
        "+new",
      ].join("\n"),
    },
    createdAt: 1,
    updatedAt: 2,
  };

  return {
    id: "turn-diff-live",
    turnId: "turn-1",
    createdAt: 1,
    updatedAt: 2,
    searchableText: "1 file changed",
    type: "turnDiff",
    entry,
  };
}

function buildTodoListBlock(): ThreadTranscriptBlockModel {
  const entry: CodexConversationItem = {
    threadId: "thread-portal",
    turnId: "turn-1",
    itemId: "todo-live",
    entryId: "todo-live",
    type: "plan",
    kind: "plan",
    semanticKind: "todoList",
    status: "inProgress",
    markdownText: [
      "1. Inspect the portal",
      "2. Patch the fixed shell",
      "3. Verify tests",
    ].join("\n"),
    rawItem: {
      plan: [
        { step: "Inspect the portal", status: "completed" },
        { step: "Patch the fixed shell", status: "in_progress" },
        { step: "Verify tests", status: "pending" },
      ],
    },
    createdAt: 1,
    updatedAt: 2,
  };

  return {
    id: "todo-live",
    turnId: "turn-1",
    createdAt: 1,
    updatedAt: 2,
    searchableText: "todo",
    type: "todoList",
    entry,
  };
}

describe("LocalConversationAboveComposerPortal", () => {
  test("renders streaming turn diffs through the fixed-content portal shell", async () => {
    let openedTurnId = "";
    const { container } = render(
      <TooltipProvider>
        <LocalConversationAboveComposerPortalHost conversationId="thread-portal" />
        <LocalConversationAboveComposerPortal
          blocks={[buildTurnDiffBlock()]}
          isLatestTurn={true}
          isStreamingTurn={true}
          threadCwd="/tmp/project"
          onOpenTurnDiffReview={(target) => {
            openedTurnId = target.turnId;
          }}
        />
      </TooltipProvider>,
    );

    await settleAsyncRender();

    const host = container.querySelector("[data-above-composer-portal]");
    expect(host?.textContent?.includes("1 file changed") ?? false).toBe(true);
    expect(host?.querySelector('[codex\\.turn_diff\\.state="in_progress"]') !== null).toBe(true);
    expect(host?.querySelector("[data-above-composer-fixed-spacer]") !== null).toBe(true);
    expect(host?.querySelector("[data-above-composer-fixed-content]") !== null).toBe(true);
    expect(host?.querySelector("[data-above-composer-fixed-fade]") !== null).toBe(true);
    expect(host?.querySelector("[data-above-composer-fixed-pill]") !== null).toBe(true);
    expect(textContent(container).includes("1 file changed")).toBe(true);

    const reviewButton = host?.querySelector<HTMLButtonElement>('button[aria-label="Review changed files"]');
    expect(reviewButton !== null).toBe(true);
    fireEvent.click(reviewButton as HTMLButtonElement);
    expect(openedTurnId).toBe("turn-1");
  });

  test("does not render fixed-content chrome for an empty portal", async () => {
    const { container } = render(
      <TooltipProvider>
        <LocalConversationAboveComposerPortalHost conversationId="thread-portal" />
        <LocalConversationAboveComposerPortal
          blocks={[]}
          isLatestTurn={true}
          isStreamingTurn={true}
          threadCwd="/tmp/project"
        />
      </TooltipProvider>,
    );

    await settleAsyncRender();

    expect(container.querySelector("[data-above-composer-fixed-content]") === null).toBe(true);
  });

  test("renders todo progress and turn diff in one fixed-content pill", async () => {
    const { container } = render(
      <TooltipProvider>
        <LocalConversationAboveComposerPortalHost conversationId="thread-portal" />
        <LocalConversationAboveComposerPortal
          blocks={[buildTodoListBlock(), buildTurnDiffBlock()]}
          isLatestTurn={true}
          isStreamingTurn={true}
          threadCwd="/tmp/project"
        />
      </TooltipProvider>,
    );

    await settleAsyncRender();

    const host = container.querySelector("[data-above-composer-portal]");
    const content = host?.textContent ?? "";
    const todoIndex = content.indexOf("Step 2 / 3");
    const diffIndex = content.indexOf("1 file changed");

    expect(host?.querySelectorAll("[data-above-composer-fixed-pill]").length ?? 0).toBe(1);
    expect(todoIndex >= 0).toBe(true);
    expect(diffIndex >= 0).toBe(true);
    expect(todoIndex < diffIndex).toBe(true);
    expect(content.includes("·")).toBe(true);
  });
});
