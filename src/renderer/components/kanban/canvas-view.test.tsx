import { beforeEach, describe, expect, vi, test } from "vitest";
import { act, fireEvent, waitFor } from "@testing-library/react";
import { createElement, StrictMode, type ReactNode } from "react";
import { createHash } from "node:crypto";
import type { BoardSummary, CardSummary } from "@/lib/types";
import { render, settleAsyncRender, textContent } from "@/test/dom";
import {
  CANVAS_SCENE_SYNC_VERSION,
  canonicalPortableCanvasSceneFingerprint,
  materializePortableCanvasScene,
  primaryCanvasBlockId,
  primaryCanvasDocumentId,
  plainTextToPortableRichText,
  type CanvasSceneMutationRequest,
  type CanvasSceneRealtimeEvent,
  type PortableCanvasScene,
} from "../../../shared/block-documents";
import { MemoryCanvasSceneOutbox } from "@/lib/canvas-scene-outbox";
import type { CanvasSceneSyncAdapter } from "@/lib/canvas-scene-provider";

type MockCanvasElement = Record<string, unknown> & {
  readonly id: string;
  readonly type: string;
};

let serverScene: PortableCanvasScene;
let serverHead = 1;
let realtimeListener: ((event: CanvasSceneRealtimeEvent) => void) | null = null;
let appliedMutations: CanvasSceneMutationRequest[] = [];
let closeFlushHandlers = new Set<() => void | Promise<void>>();
let mockSceneElements: MockCanvasElement[] = [];
let mockAppState: Record<string, unknown> = {};
let mockFiles: Record<string, unknown> = {};
let mockApiInitialized = false;
let latestOnChange:
  | ((
      elements: readonly MockCanvasElement[],
      appState: Record<string, unknown>,
      files: Record<string, unknown>,
    ) => void)
  | null = null;
let toggleSidebarCalls = 0;
let updateSceneCalls: Array<{
  readonly captureUpdate?: string;
  readonly elements?: readonly MockCanvasElement[];
}> = [];
let sidebarRenderCount = 0;
let openedCards: Array<{
  readonly projectId: string;
  readonly cardId: string;
  readonly title?: string;
}> = [];

const mockBoard = {
  columns: [{
    id: "draft",
    name: "Draft",
    cards: [
      makeCardSummary("card-1", "One"),
      makeCardSummary("card-2", "Two"),
    ],
  }],
} as unknown as BoardSummary;

function makeCardSummary(id: string, title: string): CardSummary {
  return {
    id,
    title,
    richTitle: plainTextToPortableRichText(title),
    status: "draft",
    archived: false,
    priority: undefined,
    estimate: undefined,
    tags: [],
    dueDate: undefined,
    scheduledStart: undefined,
    scheduledEnd: undefined,
    isAllDay: false,
    recurrence: undefined,
    reminders: [],
    scheduleTimezone: undefined,
    assignee: undefined,
    runInTarget: undefined,
    runInLocalPath: undefined,
    runInBaseBranch: undefined,
    runInWorktreePath: undefined,
    runInEnvironmentPath: undefined,
    revision: 1,
    created: new Date("2026-06-01T00:00:00.000Z"),
    order: 1,
    descriptionPreview: "",
    descriptionLength: 0,
    hasDescription: false,
  };
}

function makePlacedElement(cardId: string, version = 1): MockCanvasElement {
  const title = cardId === "card-2" ? "Two" : cardId === "standalone-card" ? "Standalone" : "One";
  return {
    id: `element-${cardId}`,
    type: "rectangle",
    index: cardId === "card-2" ? "b1" : "a1",
    version,
    versionNonce: cardId === "card-2" ? 22 : 11,
    isDeleted: false,
    backgroundColor: "#f8f9fa",
    customData: {
      type: "nodex-card-reference",
      targetBlockId: cardId,
      titleHint: title,
    },
    label: { text: title },
  };
}

const syncResponse = () => ({
  version: CANVAS_SCENE_SYNC_VERSION,
  projectId: "project-1",
  documentId: descriptor.documentId,
  storeEpoch: descriptor.storeEpoch,
  generation: descriptor.generation,
  headSeq: serverHead,
  sceneHash: createHash("sha256")
    .update(canonicalPortableCanvasSceneFingerprint(serverScene))
    .digest("hex"),
  scene: serverScene,
});

const adapter: CanvasSceneSyncAdapter = {
  subscribe: (_request, listener) => {
    realtimeListener = listener;
    return () => {
      if (realtimeListener === listener) realtimeListener = null;
    };
  },
  sync: async () => ({ ok: true, value: syncResponse() }),
  applyMutation: async (request) => {
    appliedMutations.push(request);
    const nextAppState = { ...serverScene.appState } as Record<string, unknown>;
    for (const [key, intent] of Object.entries(request.appStateIntents)) {
      const expected = intent.expected.kind === "value" ? intent.expected.value : undefined;
      if (JSON.stringify(nextAppState[key]) !== JSON.stringify(expected)) continue;
      if (intent.value.kind === "value") nextAppState[key] = intent.value.value;
      else delete nextAppState[key];
    }
    serverScene = materializePortableCanvasScene({
      elements: request.elementCandidates,
      appState: nextAppState,
      files: { ...serverScene.files, ...request.fileAdditions },
    });
    const baseHeadSeq = serverHead;
    serverHead += 1;
    return {
      ok: true,
      value: {
        version: CANVAS_SCENE_SYNC_VERSION,
        mutationId: request.mutationId,
        projectId: request.projectId,
        documentId: request.documentId,
        storeEpoch: request.storeEpoch,
        generation: request.generation,
        baseHeadSeq,
        headSeq: serverHead,
        duplicate: false,
        outcome: "committed",
        sceneHash: createHash("sha256")
          .update(canonicalPortableCanvasSceneFingerprint(serverScene))
          .digest("hex"),
        changedElementIds: request.elementCandidates.map((element) => element.id as string),
        appliedAppStateKeys: Object.keys(request.appStateIntents),
        skippedAppStateKeys: [],
        addedFileIds: Object.keys(request.fileAdditions),
        removedFileIds: [],
        committedAt: "2026-07-13T00:00:00.000Z",
      },
    };
  },
};

function MockExcalidraw(props: {
  readonly excalidrawAPI?: (api: unknown) => void;
  readonly initialData?: {
    readonly elements?: readonly MockCanvasElement[];
    readonly appState?: Record<string, unknown>;
    readonly files?: Record<string, unknown>;
  };
  readonly onChange?: (
    elements: readonly MockCanvasElement[],
    appState: Record<string, unknown>,
    files: Record<string, unknown>,
  ) => void;
  readonly renderTopRightUI?: () => ReactNode;
  readonly onLinkOpen?: (
    element: MockCanvasElement,
    event: { preventDefault: () => void },
  ) => void;
  readonly children?: ReactNode;
}) {
  if (!mockApiInitialized) {
    mockApiInitialized = true;
    mockSceneElements = [...(props.initialData?.elements ?? [])];
    mockAppState = { ...(props.initialData?.appState ?? {}) };
    mockFiles = { ...(props.initialData?.files ?? {}) };
  }
  props.excalidrawAPI?.({
    getSceneElementsIncludingDeleted: () => mockSceneElements,
    getAppState: () => mockAppState,
    getFiles: () => mockFiles,
    addFiles: (files: readonly { id: string }[]) => {
      for (const file of files) mockFiles[file.id] = file;
    },
    updateScene: ({ elements, appState, captureUpdate }: {
      readonly elements?: readonly MockCanvasElement[];
      readonly appState?: Record<string, unknown>;
      readonly captureUpdate?: string;
    }) => {
      updateSceneCalls.push({ captureUpdate, elements });
      if (elements) mockSceneElements = [...elements];
      if (appState) mockAppState = { ...mockAppState, ...appState };
    },
    toggleSidebar: (payload: { name: string; tab: string }) => {
      if (payload.name === "cards" && payload.tab === "browse") toggleSidebarCalls += 1;
    },
  });
  latestOnChange = props.onChange ?? null;
  return createElement(
    "div",
    { "data-testid": "excalidraw" },
    props.renderTopRightUI?.(),
    createElement("button", {
      type: "button",
      onClick: () => latestOnChange?.(mockSceneElements, mockAppState, mockFiles),
    }, "emit change"),
    createElement("button", {
      type: "button",
      onClick: () => {
        const element = mockSceneElements[0];
        if (element) props.onLinkOpen?.(element, { preventDefault: () => undefined });
      },
    }, "open first card"),
    props.children,
  );
}

const descriptor = {
  projectId: "project-1",
  ownerBlockId: primaryCanvasBlockId("project-1"),
  ownerType: "canvas",
  ownerLifecycle: "active",
  documentId: primaryCanvasDocumentId("project-1"),
  storeEpoch: "epoch-1",
  generation: 1,
  headSeq: 1,
  schemaKey: "nodex.canvas",
  schemaVersion: 1,
  readiness: "ready",
  sync: { kind: "canvas_scene" },
} as const;

vi.mock("@excalidraw/excalidraw/index.css", () => ({}));

vi.mock("./canvas-view-deps", () => ({
  loadExcalidraw: async () => ({
    Excalidraw: MockExcalidraw,
    convertToExcalidrawElements: (skeletons: readonly MockCanvasElement[]) => skeletons,
    reconcileElements: (
      local: readonly MockCanvasElement[],
      remote: readonly MockCanvasElement[],
    ) => {
      const localById = new Map(local.map((element) => [element.id, element]));
      return remote.map((element) => {
        const current = localById.get(element.id);
        return Number(current?.version ?? 0) > Number(element.version ?? 0)
          ? current
          : element;
      });
    },
    CaptureUpdateAction: { NEVER: "never", EVENTUALLY: "eventually", IMMEDIATELY: "immediately" },
    newElementWith: (element: MockCanvasElement, changes: Record<string, unknown>) => ({
      ...element,
      ...changes,
      version: Number(element.version ?? 0) + 1,
      versionNonce: 1,
    }),
  }),
  loadCanvasCardSidebar: async () => ({
    CanvasCardSidebar: ({ placedCardIds }: { placedCardIds: Set<string> }) => {
      sidebarRenderCount += 1;
      return createElement("div", { "data-testid": "card-sidebar" }, `placed:${[...placedCardIds].sort().join(",")}`);
    },
  }),
  RegisteredOwnedBlockDocumentBoundary: ({ children }: {
    readonly children: (model: unknown, controls: unknown) => ReactNode;
  }) => children({
    status: "ydoc_primary",
    projectId: "project-1",
    ownerBlockId: descriptor.ownerBlockId,
    descriptor,
  }, { reload: async () => undefined }),
  createCanvasSceneSyncAdapter: () => adapter,
  createDefaultCanvasSceneOutbox: () => new MemoryCanvasSceneOutbox(),
  registerAppCloseFlushHandler: (handler: () => void | Promise<void>) => {
    closeFlushHandlers.add(handler);
    return () => closeFlushHandlers.delete(handler);
  },
  useKanban: () => ({
    board: mockBoard,
    createCard: async () => makeCardSummary("card-new", "New Card"),
  }),
  useTheme: () => ({ resolved: "light" }),
}));

async function renderCanvas(strict = false) {
  const { CanvasView } = await import("./canvas-view");
  const canvas = createElement(CanvasView, {
    projectId: "project-1",
    databaseViewId: "view-project-1-primary",
    openCardStage: (projectId: string, cardId: string, title?: string) => {
      openedCards.push({ projectId, cardId, title });
    },
    cardStageCardId: undefined,
    cardStageCloseRef: { current: null },
  });
  return render(strict ? createElement(StrictMode, null, canvas) : canvas);
}

describe("CanvasView", () => {
  beforeEach(() => {
    serverScene = materializePortableCanvasScene({ elements: [makePlacedElement("card-1")] });
    serverHead = 1;
    realtimeListener = null;
    appliedMutations = [];
    closeFlushHandlers = new Set();
    mockSceneElements = [];
    mockAppState = {};
    mockFiles = {};
    mockApiInitialized = false;
    latestOnChange = null;
    toggleSidebarCalls = 0;
    updateSceneCalls = [];
    sidebarRenderCount = 0;
    openedCards = [];
  });

  test("mounts one scene-native Canvas surface and registers close flush", async () => {
    const view = await renderCanvas(true);
    await view.findByTestId("excalidraw");
    expect(closeFlushHandlers.size).toBe(1);
    mockSceneElements = [makePlacedElement("card-1", 2)];
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "emit change" }));
      await Promise.all(
        [...closeFlushHandlers].map((handler) => Promise.resolve(handler())),
      );
    });
    expect(appliedMutations).toHaveLength(1);
  });

  test("Cards button toggles the Excalidraw sidebar", async () => {
    const view = await renderCanvas();
    fireEvent.click(await view.findByRole("button", { name: "Cards" }));
    expect(toggleSidebarCalls).toBe(1);
  });

  test("opens a referenced standalone Card by Block identity", async () => {
    serverScene = materializePortableCanvasScene({
      elements: [makePlacedElement("standalone-card")],
    });
    const view = await renderCanvas();
    await view.findByTestId("excalidraw");
    fireEvent.click(view.getByRole("button", { name: "open first card" }));
    expect(openedCards).toEqual([{
      projectId: "project-1",
      cardId: "standalone-card",
      title: "Standalone",
    }]);
  });

  test("local observations persist through the scene provider", async () => {
    const view = await renderCanvas();
    await view.findByTestId("excalidraw");
    await settleAsyncRender();
    const initialSidebarRenderCount = sidebarRenderCount;
    mockSceneElements = [makePlacedElement("card-1"), makePlacedElement("card-2")];
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "emit change" }));
      await new Promise((resolve) => setTimeout(resolve, 180));
    });
    await waitFor(() => expect(appliedMutations).toHaveLength(1));
    expect(serverScene.elements).toHaveLength(2);
    expect(sidebarRenderCount > initialSidebarRenderCount).toBe(true);
    expect(textContent(view.container).includes("placed:card-1,card-2")).toBe(true);
  });

  test("Retry sync resubmits the visible scene after validation failure", async () => {
    const view = await renderCanvas();
    await view.findByTestId("excalidraw");
    mockSceneElements = [{ ...makePlacedElement("card-1", 2), customData: () => undefined }];
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "emit change" }));
      await new Promise((resolve) => setTimeout(resolve, 180));
    });
    await view.findByRole("button", { name: "Retry sync" });
    mockSceneElements = [{ ...makePlacedElement("card-1", 3), x: 320 }];
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Retry sync" }));
      await new Promise((resolve) => setTimeout(resolve, 180));
    });
    await waitFor(() => expect(serverScene.elements[0]?.x).toBe(320));
    expect(view.queryByRole("button", { name: "Retry sync" })).toBeNull();
  });

  test("remote canonical scenes reconcile without entering local undo", async () => {
    const view = await renderCanvas();
    await view.findByTestId("excalidraw");
    const callsBeforeRemote = updateSceneCalls.length;
    serverScene = materializePortableCanvasScene({
      elements: [{ ...makePlacedElement("card-1", 2), x: 240 }],
      appState: { gridModeEnabled: true },
    });
    serverHead += 1;
    act(() => realtimeListener?.({
      type: "canvas_scene_resync_required",
      version: CANVAS_SCENE_SYNC_VERSION,
      projectId: "project-1",
      documentId: descriptor.documentId,
      storeEpoch: descriptor.storeEpoch,
      generation: descriptor.generation,
      headSeq: serverHead,
    }));
    await waitFor(() => expect(updateSceneCalls.length > callsBeforeRemote).toBe(true));
    const latest = updateSceneCalls.at(-1);
    expect(latest?.captureUpdate).toBe("never");
    expect(mockSceneElements[0]?.x).toBe(240);
    expect(mockAppState.gridModeEnabled).toBe(true);
  });
});
