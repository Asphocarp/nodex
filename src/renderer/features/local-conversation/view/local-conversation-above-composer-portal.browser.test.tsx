import { render, waitFor } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { NodexTooltipProvider as TooltipProvider } from "@/components/ui/tooltip";
import type { ThreadTranscriptBlockModel } from "../thread-stage-types";
import {
  LocalConversationAboveComposerPortal,
  LocalConversationAboveComposerPortalHost,
} from "./local-conversation-above-composer-portal";
import {
  buildAboveComposerTodoListBlock,
  buildAboveComposerTurnDiffBlock,
} from "./local-conversation-above-composer-portal.test-fixtures";
import "../../../globals.css";

function renderPortalSurface(blocks: ThreadTranscriptBlockModel[], width: number) {
  return (
    <TooltipProvider>
      <div className="relative" style={{ width }}>
        <LocalConversationAboveComposerPortalHost conversationId="thread-portal" />
        <LocalConversationAboveComposerPortal
          blocks={blocks}
          conversationId="thread-portal"
          isLatestTurn={true}
          isStreamingTurn={true}
          threadCwd="/tmp/project"
        />
      </div>
    </TooltipProvider>
  );
}

function getPillElements(container: HTMLElement) {
  const pill = container.querySelector<HTMLElement>("[data-above-composer-fixed-pill]");
  const content = container.querySelector<HTMLElement>("[data-above-composer-fixed-pill-inner]");
  const reviewButton = container.querySelector<HTMLButtonElement>('button[aria-label="Review changed files"]');
  const step = Array.from(container.querySelectorAll<HTMLElement>("span"))
    .find((element) => element.textContent === "Step 2 / 3") ?? null;

  if (!pill || !content || !reviewButton || !step) {
    throw new Error("Expected the complete above-composer pill layout.");
  }

  return { content, pill, reviewButton, step };
}

describe("LocalConversationAboveComposerPortal layout", () => {
  test("grows from todo-only to todo plus a dynamically expanding diff without overlap", async () => {
    const todo = buildAboveComposerTodoListBlock();
    const view = render(renderPortalSurface([todo], 520));

    let todoOnlyWidth = 0;
    await waitFor(() => {
      const pill = view.container.querySelector<HTMLElement>("[data-above-composer-fixed-pill]");
      if (!pill) throw new Error("Expected the todo pill.");
      todoOnlyWidth = pill.getBoundingClientRect().width;
      expect(todoOnlyWidth).toBeGreaterThan(0);
    });

    view.rerender(renderPortalSurface([todo, buildAboveComposerTurnDiffBlock()], 520));

    let combinedWidth = 0;
    await waitFor(() => {
      const { content, pill, reviewButton, step } = getPillElements(view.container);
      const pillRect = pill.getBoundingClientRect();
      combinedWidth = pillRect.width;

      expect(combinedWidth).toBeGreaterThan(todoOnlyWidth + 40);
      expect(step.getBoundingClientRect().right).toBeLessThanOrEqual(reviewButton.getBoundingClientRect().left);
      expect(reviewButton.getBoundingClientRect().right).toBeLessThanOrEqual(pillRect.right + 0.5);
      expect(content.scrollWidth).toBeLessThanOrEqual(pill.clientWidth + 1);
    });

    view.rerender(renderPortalSurface([
      todo,
      buildAboveComposerTurnDiffBlock({ additions: 123, deletions: 87 }),
    ], 520));

    await waitFor(() => {
      const { content, pill, reviewButton, step } = getPillElements(view.container);
      const pillRect = pill.getBoundingClientRect();

      expect(pillRect.width).toBeGreaterThan(combinedWidth + 10);
      expect(step.getBoundingClientRect().right).toBeLessThanOrEqual(reviewButton.getBoundingClientRect().left);
      expect(reviewButton.getBoundingClientRect().right).toBeLessThanOrEqual(pillRect.right + 0.5);
      expect(content.scrollWidth).toBeLessThanOrEqual(pill.clientWidth + 1);
    });
  });

  test("clamps combined content to the available narrow width without overlapping the todo", async () => {
    const view = render(renderPortalSurface([
      buildAboveComposerTodoListBlock(),
      buildAboveComposerTurnDiffBlock({ additions: 123, deletions: 87 }),
    ], 280));

    await waitFor(() => {
      const { content, pill, reviewButton, step } = getPillElements(view.container);
      const boundary = pill.parentElement;
      if (!boundary) throw new Error("Expected the measured pill boundary.");

      const boundaryRect = boundary.getBoundingClientRect();
      const pillRect = pill.getBoundingClientRect();
      expect(pillRect.width).toBeGreaterThan(0);
      expect(pillRect.width).toBeLessThanOrEqual(boundaryRect.width + 0.5);
      expect(step.getBoundingClientRect().right).toBeLessThanOrEqual(reviewButton.getBoundingClientRect().left);
      expect(reviewButton.getBoundingClientRect().right).toBeLessThanOrEqual(pillRect.right + 0.5);
      expect(content.scrollWidth).toBeLessThanOrEqual(pill.clientWidth + 1);
    });
  });
});
