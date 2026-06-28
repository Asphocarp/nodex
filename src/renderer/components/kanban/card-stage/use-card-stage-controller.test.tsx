import { act } from "@testing-library/react";
import { describe, expect, test } from "bun:test";
import type { ReactNode } from "react";
import { useCardStageController } from "./use-card-stage-controller";
import type { CardStageProps } from "./types";
import type { Card, CardInput, CardUpdateField, CardUpdateMutationResult, CardSummary } from "@/lib/types";
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

function toTestSummary(card: Card): CardSummary {
  const { description, ...summary } = card;
  return {
    ...summary,
    descriptionPreview: description,
    descriptionLength: description.length,
    hasDescription: description.trim().length > 0,
  };
}

function buildUpdatedResult(updates: Partial<CardInput>): CardUpdateMutationResult {
  const card = buildUpdatedCard(updates);
  return {
    status: "updated",
    projectId: "project-1",
    cardId: card.id,
    revision: card.revision ?? 2,
    summary: toTestSummary({
      ...card,
      revision: card.revision ?? 2,
    }),
    changedFields: Object.keys(updates) as CardUpdateField[],
    didMutate: true,
  };
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
    onUpdate: async (_columnId, _cardId, updates): Promise<CardUpdateMutationResult> => buildUpdatedResult(updates),
    onPatch: () => undefined,
    onDelete: async () => undefined,
    onMove: async () => undefined,
    ...overrides,
  };
}

function renderController(props: CardStageProps) {
  let controller: CardStageController | null = null;

  function Harness({ nextProps, children }: { nextProps: CardStageProps; children?: ReactNode }) {
    controller = useCardStageController(nextProps);
    return <>{children}</>;
  }

  const view = render(<Harness nextProps={props} />);
  if (!controller) {
    throw new Error("Expected Card Stage controller to render.");
  }

  return {
    view,
    rerender(nextProps: CardStageProps) {
      view.rerender(<Harness nextProps={nextProps} />);
    },
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
        return buildUpdatedResult(updates);
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

    expect(flushCount > 0).toBeTrue();
    result.view.unmount();
  });

  test("description drafts stay local without updating the scoped board overlay", async () => {
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
    expect(overlay).toBe(null);
    result.view.unmount();
  });

  test("description auto-save waits for the dedicated 1500ms debounce", async () => {
    resetCardDraftStoreForTest();
    const updatesSeen: Partial<CardInput>[] = [];
    const result = renderController(buildProps({
      onUpdate: async (_columnId, _cardId, updates) => {
        updatesSeen.push(updates);
        return buildUpdatedResult(updates);
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

  test("description save in flight keeps stale card props from replacing the local draft", async () => {
    resetCardDraftStoreForTest();
    type TimeoutCallback = Parameters<typeof globalThis.setTimeout>[0];
    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;
    const scheduled: Array<{ callback: TimeoutCallback; delay: number | undefined }> = [];
    let resolveUpdate: ((result: CardUpdateMutationResult) => void) | null = null;
    const baseCard = buildCard({ revision: 1 });
    const props = buildProps({
      card: baseCard,
      onUpdate: async () => new Promise<CardUpdateMutationResult>((resolve) => {
        resolveUpdate = resolve;
      }),
    });
    const result = renderController(props);
    await settleAsyncRender();

    globalThis.setTimeout = ((callback: TimeoutCallback, delay?: number) => {
      scheduled.push({ callback, delay });
      return scheduled.length as unknown as ReturnType<typeof globalThis.setTimeout>;
    }) as typeof globalThis.setTimeout;
    globalThis.clearTimeout = (() => undefined) as typeof globalThis.clearTimeout;

    try {
      act(() => {
        result.controller.handleDescriptionChange("Draft body");
      });
    } finally {
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
    }

    await act(async () => {
      const callback = scheduled[0]?.callback;
      if (typeof callback === "function") {
        callback();
      }
      await Promise.resolve();
    });

    result.rerender(buildProps({
      ...props,
      card: buildCard({
        description: "Persisted body",
        revision: 1,
      }),
    }));
    await settleAsyncRender();

    expect(result.controller.description).toBe("Draft body");

    await act(async () => {
      resolveUpdate?.(buildUpdatedResult({ description: "Draft body" }));
      await Promise.resolve();
    });
    result.view.unmount();
  });

  test("conflict overwrite sends the current flushed description draft", async () => {
    resetCardDraftStoreForTest();
    const updatesSeen: Partial<CardInput>[] = [];
    const result = renderController(buildProps({
      onUpdate: async (_columnId, _cardId, updates) => {
        updatesSeen.push(updates);
        if (updatesSeen.length === 1) {
          return {
            status: "conflict",
            card: buildCard({
              description: "Remote body",
              revision: 2,
            }),
          };
        }
        return buildUpdatedResult(updates);
      },
    }));
    await settleAsyncRender();

    await act(async () => {
      result.controller.handleDescriptionChange("First local body");
      result.controller.handleDescriptionBlur();
      await Promise.resolve();
    });
    await settleAsyncRender();

    result.controller.descriptionFlushHandleRef.current = {
      flushPendingChange: () => "Current editor body",
      hasPendingChange: () => true,
    };

    await act(async () => {
      await result.controller.handleOverwriteMine();
    });

    expect(updatesSeen.length).toBe(2);
    expect(updatesSeen[1]?.description).toBe("Current editor body");
    result.view.unmount();
  });

  test("only the active panel tab owns shared Card Stage refs", async () => {
    resetCardDraftStoreForTest();
    const closeRef = { current: null as (() => Promise<void>) | null };
    const persistRef = { current: null as (() => Promise<void>) | null };
    const sessionSnapshotRef = { current: null as { projectId: string; cardId: string; titleSnapshot: string } | null };
    let hiddenCloseCount = 0;
    let activeCloseCount = 0;
    const hiddenProps = buildProps({
      card: buildCard({ id: "hidden-card", title: "Hidden Card" }),
      closeRef,
      persistRef,
      sessionSnapshotRef,
      isActivePanelTab: false,
      onClose: () => {
        hiddenCloseCount += 1;
      },
    });
    const activeProps = buildProps({
      card: buildCard({ id: "active-card", title: "Active Card" }),
      closeRef,
      persistRef,
      sessionSnapshotRef,
      isActivePanelTab: true,
      onClose: () => {
        activeCloseCount += 1;
      },
    });

    function Harness() {
      useCardStageController(hiddenProps);
      useCardStageController(activeProps);
      return null;
    }

    const view = render(<Harness />);
    await settleAsyncRender();

    expect(closeRef.current === null).toBeFalse();
    expect(persistRef.current === null).toBeFalse();
    expect(sessionSnapshotRef.current?.cardId).toBe("active-card");

    await act(async () => {
      await closeRef.current?.();
    });

    expect(hiddenCloseCount).toBe(0);
    expect(activeCloseCount).toBe(1);
    view.unmount();
  });

  test("deactivating a panel tab persists pending description editor content", async () => {
    resetCardDraftStoreForTest();
    const updatesSeen: Partial<CardInput>[] = [];
    const props = buildProps({
      isActivePanelTab: true,
      onUpdate: async (_columnId, _cardId, updates) => {
        updatesSeen.push(updates);
        return buildUpdatedResult(updates);
      },
    });
    const result = renderController(props);
    await settleAsyncRender();
    let flushCount = 0;
    result.controller.descriptionFlushHandleRef.current = {
      flushPendingChange: () => {
        flushCount += 1;
        return "Persisted on deactivate";
      },
      hasPendingChange: () => true,
    };

    await act(async () => {
      result.rerender(buildProps({
        ...props,
        isActivePanelTab: false,
      }));
      await Promise.resolve();
    });
    await settleAsyncRender();

    expect(flushCount > 0).toBeTrue();
    expect(updatesSeen.length).toBe(1);
    expect(updatesSeen[0]?.description).toBe("Persisted on deactivate");
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
