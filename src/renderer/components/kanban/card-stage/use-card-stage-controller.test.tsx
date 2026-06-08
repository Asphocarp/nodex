import { act } from "@testing-library/react";
import { describe, expect, test } from "bun:test";
import type { ReactNode } from "react";
import { useCardStageController } from "./use-card-stage-controller";
import type { CardStageProps } from "./types";
import type { Card, CardInput, CardUpdateMutationResult } from "@/lib/types";
import {
  getCardDraftOverlay,
  resetCardDraftStoreForTest,
} from "@/lib/card-draft-store";
import { render, settleAsyncRender } from "@/test/dom";

type CardStageController = ReturnType<typeof useCardStageController>;

function buildCard(overrides: Partial<Card> = {}): Card {
  return {
    id: "card-1",
    status: "in_progress",
    archived: false,
    title: "Persisted title",
    description: "Persisted body",
    tags: [],
    agentBlocked: false,
    created: new Date("2026-01-01T00:00:00.000Z"),
    order: 1,
    ...overrides,
  };
}

function buildUpdatedCard(updates: Partial<CardInput>): Card {
  const card = buildCard({
    ...updates,
    priority: updates.priority ?? undefined,
    estimate: updates.estimate ?? undefined,
    dueDate: updates.dueDate ?? undefined,
    scheduledStart: updates.scheduledStart ?? undefined,
    scheduledEnd: updates.scheduledEnd ?? undefined,
    isAllDay: updates.isAllDay ?? undefined,
    recurrence: updates.recurrence ?? undefined,
    scheduleTimezone: updates.scheduleTimezone ?? undefined,
    runInLocalPath: updates.runInLocalPath ?? undefined,
    runInBaseBranch: updates.runInBaseBranch ?? undefined,
    runInWorktreePath: updates.runInWorktreePath ?? undefined,
    runInEnvironmentPath: updates.runInEnvironmentPath ?? undefined,
  });

  return card;
}

function buildProps(overrides: Partial<CardStageProps> = {}): CardStageProps {
  const card = overrides.card === undefined ? buildCard() : overrides.card;

  return {
    card,
    columnId: "in_progress",
    columnName: "In progress",
    projectId: "project-1",
    availableTags: [],
    onClose: () => undefined,
    onUpdate: async (_columnId, _cardId, updates): Promise<CardUpdateMutationResult> => ({
      status: "updated",
      card: buildUpdatedCard(updates),
    }),
    onPatch: () => undefined,
    onDelete: async () => undefined,
    onMove: async () => undefined,
    ...overrides,
  };
}

function renderController(props: CardStageProps) {
  let controller: CardStageController | null = null;

  function Harness({ children }: { children?: ReactNode }) {
    controller = useCardStageController(props);
    return <>{children}</>;
  }

  const view = render(<Harness />);
  if (!controller) {
    throw new Error("Expected Card Stage controller to render.");
  }

  return {
    view,
    get controller() {
      if (!controller) {
        throw new Error("Expected Card Stage controller to stay mounted.");
      }
      return controller;
    },
  };
}

describe("useCardStageController", () => {
  test("handlePersist flushes pending editor content before saving", async () => {
    resetCardDraftStoreForTest();
    const updatesSeen: Partial<CardInput>[] = [];
    const props = buildProps({
      onUpdate: async (_columnId, _cardId, updates) => {
        updatesSeen.push(updates);
        return {
          status: "updated",
          card: buildUpdatedCard(updates),
        };
      },
    });
    const result = renderController(props);
    await settleAsyncRender();
    let flushCount = 0;
    result.controller.descriptionFlushHandleRef.current = {
      flushPendingChange: () => {
        flushCount += 1;
        return "Flushed body";
      },
      hasPendingChange: () => true,
    };

    await act(async () => {
      await result.controller.handleClose();
    });

    expect(flushCount > 0).toBeTrue();
    expect(updatesSeen.length).toBe(1);
    expect(updatesSeen[0]?.description).toBe("Flushed body");
    result.view.unmount();
  });

  test("raw-content toggle flushes pending editor content before showing raw NFM", async () => {
    resetCardDraftStoreForTest();
    const result = renderController(buildProps());
    await settleAsyncRender();
    let flushCount = 0;
    result.controller.descriptionFlushHandleRef.current = {
      flushPendingChange: () => {
        flushCount += 1;
        return "Raw body";
      },
      hasPendingChange: () => true,
    };

    act(() => {
      result.controller.handleToggleShowRawContent();
    });

    expect(flushCount).toBe(1);
    result.view.unmount();
  });

  test("description drafts stay local and update the scoped preview overlay", async () => {
    resetCardDraftStoreForTest();
    let patchCount = 0;
    const result = renderController(buildProps({
      onPatch: () => {
        patchCount += 1;
      },
    }));
    await settleAsyncRender();

    act(() => {
      result.controller.handleDescriptionChange("Draft body");
    });
    await settleAsyncRender();

    const overlay = getCardDraftOverlay("project-1", "card-1");
    expect(patchCount).toBe(0);
    expect(overlay?.description).toBe("Draft body");
    result.view.unmount();
  });

  test("description auto-save waits for the dedicated 1500ms debounce", async () => {
    resetCardDraftStoreForTest();
    const updatesSeen: Partial<CardInput>[] = [];
    const result = renderController(buildProps({
      onUpdate: async (_columnId, _cardId, updates) => {
        updatesSeen.push(updates);
        return {
          status: "updated",
          card: buildUpdatedCard(updates),
        };
      },
    }));
    await settleAsyncRender();

    type TimeoutCallback = Parameters<typeof globalThis.setTimeout>[0];
    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;
    const scheduled: Array<{ callback: TimeoutCallback; delay: number | undefined }> = [];

    globalThis.setTimeout = ((callback: TimeoutCallback, delay?: number) => {
      scheduled.push({ callback, delay });
      return scheduled.length as unknown as ReturnType<typeof globalThis.setTimeout>;
    }) as typeof globalThis.setTimeout;
    globalThis.clearTimeout = (() => undefined) as typeof globalThis.clearTimeout;

    try {
      act(() => {
        result.controller.handleDescriptionChange("Debounced body");
      });
    } finally {
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
    }

    expect(scheduled.length).toBe(1);
    expect(scheduled[0]?.delay).toBe(1500);
    expect(updatesSeen.length).toBe(0);

    await act(async () => {
      const callback = scheduled[0]?.callback;
      if (typeof callback === "function") {
        callback();
      }
    });
    await settleAsyncRender();

    expect(updatesSeen.length).toBe(1);
    expect(updatesSeen[0]?.description).toBe("Debounced body");
    result.view.unmount();
  });

  test("title auto-save keeps the shared 500ms field debounce", async () => {
    resetCardDraftStoreForTest();
    const result = renderController(buildProps());
    await settleAsyncRender();

    type TimeoutCallback = Parameters<typeof globalThis.setTimeout>[0];
    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;
    const scheduled: Array<{ callback: TimeoutCallback; delay: number | undefined }> = [];

    globalThis.setTimeout = ((callback: TimeoutCallback, delay?: number) => {
      scheduled.push({ callback, delay });
      return scheduled.length as unknown as ReturnType<typeof globalThis.setTimeout>;
    }) as typeof globalThis.setTimeout;
    globalThis.clearTimeout = (() => undefined) as typeof globalThis.clearTimeout;

    try {
      act(() => {
        result.controller.handleTitleChange("Debounced title");
      });
    } finally {
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
    }

    expect(scheduled.length).toBe(1);
    expect(scheduled[0]?.delay).toBe(500);
    result.view.unmount();
  });
});
