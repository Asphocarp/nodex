import { act } from "@testing-library/react";
import { describe, expect, test } from "bun:test";
import type { ReactNode } from "react";
import {
  useCardStageController,
  type CardStageControllerDependencies,
} from "./use-card-stage-controller";
import type { CardStageProps } from "./types";
import type { Card, CardInput, CardUpdateField, CardUpdateMutationResult, CardSummary } from "@/lib/types";
import {
  getCardDraftOverlay,
  resetCardDraftStoreForTest,
} from "@/lib/card-draft-store";
import {
  forgetScrollPosition,
  loadScrollPosition,
  saveScrollPosition,
} from "@/lib/card-stage-scroll";
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

function buildPrimaryDocumentAuthority(): CardStageProps["documentAuthority"] {
  return {
    kind: "ydoc_primary",
    descriptor: {
      projectId: "project-1",
      ownerBlockId: "card-1",
      ownerType: "card",
      ownerLifecycle: "active",
      documentId: "document-1",
      storeEpoch: "store-epoch-1",
      generation: 1,
      headSeq: 1,
      schemaKey: "nodex.card",
      schemaVersion: 1,
      readiness: "ready",
      authority: "ydoc_primary",
      stateVector: new Uint8Array(),
    },
    reload: async () => undefined,
  };
}

function buildProps(overrides: Partial<CardStageProps> = {}): CardStageProps {
  const card = overrides.card === undefined ? buildCard() : overrides.card;

  return {
    card,
    documentAuthority: { kind: "legacy_shadow" },
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

function renderController(
  props: CardStageProps,
  dependencies: CardStageControllerDependencies = {},
) {
  let controller: CardStageController | null = null;

  function Harness({ nextProps, children }: { nextProps: CardStageProps; children?: ReactNode }) {
    controller = useCardStageController(nextProps, dependencies);
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

function readCardStageStoredScroll(projectId: string, cardId: string): number | null {
  const raw = localStorage.getItem("nodex-card-stage-scroll-v1");
  if (!raw) return null;
  const parsed = JSON.parse(raw) as Record<string, number>;
  return parsed[`card-stage:${projectId}:${cardId}`] ?? null;
}

async function withQueuedAnimationFrames<T>(run: (flushFrame: () => void) => T | Promise<T>): Promise<T> {
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  const callbacks: FrameRequestCallback[] = [];
  globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    callbacks.push(callback);
    return callbacks.length;
  }) as typeof requestAnimationFrame;

  try {
    return await run(() => {
      callbacks.shift()?.(0);
    });
  } finally {
    globalThis.requestAnimationFrame = originalRequestAnimationFrame;
  }
}

describe("useCardStageController", () => {
  test("authority cutover invalidates already queued legacy content callbacks", async () => {
    resetCardDraftStoreForTest();
    const updatesSeen: Partial<CardInput>[] = [];
    const legacyProps = buildProps({
      onUpdate: async (_columnId, _cardId, updates) => {
        updatesSeen.push(updates);
        return buildUpdatedResult(updates);
      },
    });
    const result = renderController(legacyProps);
    await settleAsyncRender();

    type TimeoutCallback = Parameters<typeof globalThis.setTimeout>[0];
    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;
    const callbacks: TimeoutCallback[] = [];
    globalThis.setTimeout = ((callback: TimeoutCallback) => {
      callbacks.push(callback);
      return callbacks.length as unknown as ReturnType<typeof globalThis.setTimeout>;
    }) as typeof globalThis.setTimeout;
    globalThis.clearTimeout = (() => undefined) as typeof globalThis.clearTimeout;
    try {
      act(() => {
        result.controller.handleTitleChange("Queued legacy title");
        result.controller.handleDescriptionChange("Queued legacy body");
        result.rerender(buildProps({
          ...legacyProps,
          documentAuthority: buildPrimaryDocumentAuthority(),
        }));
      });
    } finally {
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
    }

    await act(async () => {
      for (const callback of callbacks) {
        if (typeof callback === "function") callback();
      }
      await Promise.resolve();
    });
    await settleAsyncRender();

    expect(callbacks.length).toBe(2);
    expect(updatesSeen.length).toBe(0);
    result.view.unmount();
  });

  test("primary document authority never routes title or description through legacy writes", async () => {
    resetCardDraftStoreForTest();
    const updatesSeen: Partial<CardInput>[] = [];
    let patchCount = 0;
    let flushCount = 0;
    let documentPersistCount = 0;
    const persistRef = { current: null as (() => Promise<void>) | null };
    const props = buildProps({
      documentAuthority: buildPrimaryDocumentAuthority(),
      isActivePanelTab: true,
      persistRef,
      onPatch: () => {
        patchCount += 1;
      },
      onUpdate: async (_columnId, _cardId, updates) => {
        updatesSeen.push(updates);
        return buildUpdatedResult(updates);
      },
    });
    const result = renderController(props, {
      persistDocument: async () => {
        documentPersistCount += 1;
      },
    });
    await settleAsyncRender();
    result.controller.descriptionFlushHandleRef.current = {
      flushPendingChange: () => {
        flushCount += 1;
        return "Legacy editor body";
      },
      hasPendingChange: () => true,
    };

    act(() => {
      result.controller.handleTitleChange("Legacy title attempt");
      result.controller.handleTitleBlur();
      result.controller.handleDescriptionPendingChange();
      result.controller.handleDescriptionChange("Legacy body attempt");
      result.controller.handleDescriptionBlur();
    });
    await act(async () => {
      await persistRef.current?.();
    });
    await act(async () => {
      result.rerender(buildProps({
        ...props,
        isActivePanelTab: false,
      }));
      await Promise.resolve();
    });
    await settleAsyncRender();

    expect(result.controller.title).toBe("Persisted title");
    expect(result.controller.description).toBe("Persisted body");
    expect(flushCount).toBe(0);
    expect(patchCount).toBe(0);
    expect(updatesSeen.length).toBe(0);
    expect(documentPersistCount).toBe(2);
    result.view.unmount();
  });

  test("primary document authority keeps metadata writes active", async () => {
    resetCardDraftStoreForTest();
    const updatesSeen: Partial<CardInput>[] = [];
    const result = renderController(buildProps({
      documentAuthority: buildPrimaryDocumentAuthority(),
      onUpdate: async (_columnId, _cardId, updates) => {
        updatesSeen.push(updates);
        return buildUpdatedResult(updates);
      },
    }));
    await settleAsyncRender();

    await act(async () => {
      result.controller.handlePriorityChange("p1-high");
      await Promise.resolve();
    });
    await settleAsyncRender();

    expect(updatesSeen.length).toBe(1);
    expect(updatesSeen[0]?.priority).toBe("p1-high");
    expect(Object.hasOwn(updatesSeen[0] ?? {}, "title")).toBeFalse();
    expect(Object.hasOwn(updatesSeen[0] ?? {}, "description")).toBeFalse();
    result.view.unmount();
  });

  test("document title updates the primary session snapshot without a legacy mutation", async () => {
    resetCardDraftStoreForTest();
    const updatesSeen: Partial<CardInput>[] = [];
    let patchCount = 0;
    const sessionSnapshotRef = {
      current: null as { projectId: string; cardId: string; titleSnapshot: string } | null,
    };
    const result = renderController(buildProps({
      documentAuthority: buildPrimaryDocumentAuthority(),
      sessionSnapshotRef,
      onPatch: () => {
        patchCount += 1;
      },
      onUpdate: async (_columnId, _cardId, updates) => {
        updatesSeen.push(updates);
        return buildUpdatedResult(updates);
      },
    }));
    await settleAsyncRender();

    act(() => {
      result.controller.handleDocumentTitleChange("Live document title");
    });
    await settleAsyncRender();

    expect(result.controller.title).toBe("Live document title");
    expect(sessionSnapshotRef.current?.titleSnapshot).toBe("Live document title");
    expect(patchCount).toBe(0);
    expect(updatesSeen.length).toBe(0);
    result.view.unmount();
  });

  test("primary conflict overwrite strips title and description from a legacy conflict", async () => {
    resetCardDraftStoreForTest();
    const updatesSeen: Partial<CardInput>[] = [];
    const persistRef = { current: null as (() => Promise<void>) | null };
    const legacyProps = buildProps({
      persistRef,
      onUpdate: async (_columnId, _cardId, updates) => {
        updatesSeen.push(updates);
        if (updatesSeen.length === 1) {
          return {
            status: "conflict",
            card: buildCard({
              title: "Remote title",
              description: "Remote body",
              revision: 2,
            }),
          };
        }
        return buildUpdatedResult(updates);
      },
    });
    const result = renderController(legacyProps);
    await settleAsyncRender();

    act(() => {
      result.controller.handleTitleChange("Local title");
      result.controller.handleDescriptionChange("Local body");
    });
    await settleAsyncRender();
    await act(async () => {
      await persistRef.current?.();
    });
    await settleAsyncRender();

    expect(updatesSeen.length).toBe(1);
    expect(Object.hasOwn(updatesSeen[0] ?? {}, "title")).toBeTrue();
    expect(Object.hasOwn(updatesSeen[0] ?? {}, "description")).toBeTrue();

    result.rerender(buildProps({
      ...legacyProps,
      documentAuthority: buildPrimaryDocumentAuthority(),
    }));
    await settleAsyncRender();
    await act(async () => {
      await result.controller.handleOverwriteMine();
    });
    await settleAsyncRender();

    expect(updatesSeen.length).toBe(2);
    expect(Object.hasOwn(updatesSeen[1] ?? {}, "title")).toBeFalse();
    expect(Object.hasOwn(updatesSeen[1] ?? {}, "description")).toBeFalse();
    result.view.unmount();
  });

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

  test("pending raw editor description transaction keeps same-card props from replacing local draft", async () => {
    resetCardDraftStoreForTest();
    const baseCard = buildCard({ revision: 1 });
    const props = buildProps({ card: baseCard });
    const result = renderController(props);
    await settleAsyncRender();

    result.controller.descriptionFlushHandleRef.current = {
      flushPendingChange: () => "Local body",
      hasPendingChange: () => true,
    };

    act(() => {
      result.controller.handleDescriptionPendingChange();
    });

    result.rerender(buildProps({
      ...props,
      card: buildCard({
        description: "Remote body",
        revision: 2,
      }),
    }));
    await settleAsyncRender();

    expect(result.controller.description).toBe("Persisted body");

    act(() => {
      result.controller.handleDescriptionChange("Local body");
    });
    await settleAsyncRender();

    expect(result.controller.description).toBe("Local body");
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

  test("flushes the latest scroll when unmounted before the debounce fires", async () => {
    resetCardDraftStoreForTest();
    forgetScrollPosition("project-1", "card-1");
    const result = renderController(buildProps());
    await settleAsyncRender();

    const scrollContainer = document.createElement("div");
    act(() => {
      result.controller.setScrollContainerRef(scrollContainer);
      scrollContainer.scrollTop = 184;
      result.controller.handleScroll();
      result.view.unmount();
    });

    expect(loadScrollPosition("project-1", "card-1")).toBe(184);
    expect(readCardStageStoredScroll("project-1", "card-1")).toBe(184);
  });

  test("restores the same card scroll when the scroll container remounts", async () => {
    resetCardDraftStoreForTest();
    forgetScrollPosition("project-1", "card-1");
    saveScrollPosition("project-1", "card-1", 240);

    await withQueuedAnimationFrames(async (flushFrame) => {
      const result = renderController(buildProps());
      await settleAsyncRender();
      const firstScrollContainer = document.createElement("div");

      act(() => {
        result.controller.setScrollContainerRef(firstScrollContainer);
      });
      expect(firstScrollContainer.scrollTop).toBe(240);
      firstScrollContainer.scrollTop = 0;
      flushFrame();
      expect(firstScrollContainer.scrollTop).toBe(240);

      act(() => {
        firstScrollContainer.scrollTop = 316;
        result.controller.handleScroll();
        result.controller.setScrollContainerRef(null);
      });

      const secondScrollContainer = document.createElement("div");
      act(() => {
        result.controller.setScrollContainerRef(secondScrollContainer);
      });
      expect(secondScrollContainer.scrollTop).toBe(316);
      secondScrollContainer.scrollTop = 0;
      flushFrame();
      flushFrame();
      expect(secondScrollContainer.scrollTop).toBe(316);

      result.view.unmount();
    });
  });

  test("deactivating a retained panel tab does not reset mounted scroll", async () => {
    resetCardDraftStoreForTest();
    forgetScrollPosition("project-1", "card-1");
    saveScrollPosition("project-1", "card-1", 240);
    const props = buildProps({ isActivePanelTab: true });
    const result = renderController(props);
    await settleAsyncRender();
    const scrollContainer = document.createElement("div");

    act(() => {
      result.controller.setScrollContainerRef(scrollContainer);
    });
    expect(scrollContainer.scrollTop).toBe(240);

    act(() => {
      scrollContainer.scrollTop = 372;
      result.controller.handleScroll();
      result.rerender(buildProps({
        ...props,
        isActivePanelTab: false,
      }));
    });

    expect(scrollContainer.scrollTop).toBe(372);
    expect(loadScrollPosition("project-1", "card-1")).toBe(372);
    result.view.unmount();
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
