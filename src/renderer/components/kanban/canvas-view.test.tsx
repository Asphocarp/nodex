import { beforeEach, describe, expect, vi, test } from "vitest";
import { act, fireEvent, waitFor } from "@testing-library/react";
import { createElement, StrictMode, type ReactNode } from "react";
import type { BoardSummary, CardSummary } from "@/lib/types";
import { render, settleAsyncRender, textContent } from "@/test/dom";
import {
  applyCanvasSceneSnapshot,
  createCanvasDocument,
  inspectCanvasDocument,
  primaryCanvasBlockId,
  primaryCanvasDocumentId,
  type CanvasDocumentEnvelope,
} from "../../../shared/block-documents";

type MockCanvasElement = Record<string, unknown> & {
  readonly id: string;
  readonly type: string;
};

let mockEnvelope: CanvasDocumentEnvelope = createCanvasDocument({
  documentId: primaryCanvasDocumentId("project-1"),
});
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
let persistPreparers = 0;
let relocationPreparers = 0;
let openedCards: Array<{
  readonly projectId: string;
  readonly cardId: string;
  readonly title?: string;
}> = [];

const mockBoard = {
  columns: [
    {
      id: "draft",
      name: "Draft",
      cards: [
        makeCardSummary("card-1", "One"),
        makeCardSummary("card-2", "Two"),
      ],
    },
  ],
} as unknown as BoardSummary;

function makeCardSummary(id: string, title: string): CardSummary {
  return {
    id,
    title,
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
    agentBlocked: false,
    agentStatus: undefined,
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

function makePlacedElement(
  cardId: string,
  version = 1,
): MockCanvasElement {
  const title = cardId === "card-2" ? "Two" : "One";
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
    getSceneElements: () =>
      mockSceneElements.filter((element) => element.isDeleted !== true),
    getSceneElementsIncludingDeleted: () => mockSceneElements,
    getAppState: () => mockAppState,
    getFiles: () => mockFiles,
    addFiles: (files: readonly { id: string }[]) => {
      for (const file of files) mockFiles[file.id] = file;
    },
    updateScene: ({
      elements,
      appState,
      captureUpdate,
    }: {
      readonly elements?: readonly MockCanvasElement[];
      readonly appState?: Record<string, unknown>;
      readonly captureUpdate?: string;
    }) => {
      updateSceneCalls.push({ captureUpdate, elements });
      if (elements) mockSceneElements = [...elements];
      if (appState) mockAppState = { ...mockAppState, ...appState };
    },
    toggleSidebar: (payload: { name: string; tab: string }) => {
      if (payload.name === "cards" && payload.tab === "browse") {
        toggleSidebarCalls += 1;
      }
    },
  });
  latestOnChange = props.onChange ?? null;

  return createElement(
    "div",
    { "data-testid": "excalidraw" },
    props.renderTopRightUI?.(),
    createElement(
      "button",
      {
        type: "button",
        onClick: () =>
          latestOnChange?.(mockSceneElements, mockAppState, mockFiles),
      },
      "emit change",
    ),
    createElement(
      "button",
      {
        type: "button",
        onClick: () => {
          const element = mockSceneElements[0];
          if (element) props.onLinkOpen?.(element, { preventDefault: () => undefined });
        },
      },
      "open first card",
    ),
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
  authority: "ydoc_primary",
  stateVector: new Uint8Array(),
} as const;

const runtime = {
  getStatus: () => ({ writeFrozen: false }),
  getWriteFrozen: () => false,
  registerPersistPreparer: () => {
    persistPreparers += 1;
    return () => {
      persistPreparers -= 1;
    };
  },
  registerRelocationPreparer: () => {
    relocationPreparers += 1;
    return () => {
      relocationPreparers -= 1;
    };
  },
};

vi.mock("@excalidraw/excalidraw/index.css", () => ({}));

vi.mock("./canvas-view-deps", () => ({
  loadExcalidraw: async () => ({
    Excalidraw: MockExcalidraw,
    convertToExcalidrawElements: (skeletons: readonly MockCanvasElement[]) =>
      skeletons,
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
    CaptureUpdateAction: {
      NEVER: "never",
      EVENTUALLY: "eventually",
      IMMEDIATELY: "immediately",
    },
    newElementWith: (
      element: MockCanvasElement,
      changes: Record<string, unknown>,
    ) => ({
      ...element,
      ...changes,
      version: Number(element.version ?? 0) + 1,
      versionNonce: 1,
    }),
  }),
  loadCanvasCardSidebar: async () => ({
    CanvasCardSidebar: ({ placedCardIds }: { placedCardIds: Set<string> }) => {
      sidebarRenderCount += 1;
      return createElement(
        "div",
        { "data-testid": "card-sidebar" },
        `placed:${[...placedCardIds].sort().join(",")}`,
      );
    },
  }),
  RegisteredOwnedBlockDocumentBoundary: ({ children }: {
    readonly children: (model: unknown, controls: unknown) => ReactNode;
  }) =>
    children(
      {
        status: "ydoc_primary",
        projectId: "project-1",
        ownerBlockId: descriptor.ownerBlockId,
        descriptor,
      },
      { reload: async () => undefined },
    ),
  OwnedBlockDocumentSurface: ({ children }: {
    readonly children: (surface: unknown) => ReactNode;
  }) =>
    children({
      kind: "scene_graph",
      ...inspectCanvasDocument(mockEnvelope.document).envelope,
      descriptor,
      runtime,
      awareness: {},
      clientSessionId: "session-1",
      status: { writeFrozen: false },
    }),
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
    mockEnvelope.document?.destroy();
    mockEnvelope = createCanvasDocument({
      documentId: descriptor.documentId,
      initialScene: {
        elements: [makePlacedElement("card-1")],
        appState: {},
        files: {},
      },
    });
    mockSceneElements = [];
    mockAppState = {};
    mockFiles = {};
    mockApiInitialized = false;
    latestOnChange = null;
    toggleSidebarCalls = 0;
    updateSceneCalls = [];
    sidebarRenderCount = 0;
    persistPreparers = 0;
    relocationPreparers = 0;
    openedCards = [];
  });

  test("mounts one Canvas Y.Doc surface without a render loop", async () => {
    const view = await renderCanvas(true);

    await waitFor(() => {
      expect(view.getByTestId("excalidraw").getAttribute("data-testid")).toBe(
        "excalidraw",
      );
    });
    expect(persistPreparers).toBe(1);
    expect(relocationPreparers).toBe(1);
  });

  test("Cards button toggles the Excalidraw sidebar", async () => {
    const view = await renderCanvas();

    const button = await view.findByRole("button", { name: "Cards" });
    fireEvent.click(button);

    expect(toggleSidebarCalls).toBe(1);
  });

  test("opens a referenced standalone Card by Block identity without a Database lookup", async () => {
    mockEnvelope.document.destroy();
    mockEnvelope = createCanvasDocument({
      documentId: descriptor.documentId,
      initialScene: {
        elements: [
          {
            ...makePlacedElement("standalone-card"),
            customData: {
              type: "nodex-card-reference",
              targetBlockId: "standalone-card",
              titleHint: "Standalone",
            },
            label: { text: "Standalone" },
          },
        ],
        appState: {},
        files: {},
      },
    });
    const view = await renderCanvas();
    await view.findByTestId("excalidraw");

    fireEvent.click(view.getByRole("button", { name: "open first card" }));

    expect(JSON.stringify(openedCards)).toBe(
      JSON.stringify([
        {
          projectId: "project-1",
          cardId: "standalone-card",
          title: "Standalone",
        },
      ]),
    );
  });

  test("local scene observations update the Canvas Y.Doc and only rerender changed placement", async () => {
    const view = await renderCanvas();
    await view.findByTestId("excalidraw");
    await settleAsyncRender();
    const initialSidebarRenderCount = sidebarRenderCount;

    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "emit change" }));
      await Promise.resolve();
    });
    expect(sidebarRenderCount).toBe(initialSidebarRenderCount);

    mockSceneElements = [
      makePlacedElement("card-1"),
      makePlacedElement("card-2"),
    ];
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "emit change" }));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(
        inspectCanvasDocument(mockEnvelope.document).materialization.elements
          .length,
      ).toBe(2);
    });

    expect(sidebarRenderCount > initialSidebarRenderCount).toBe(true);
    expect(textContent(view.container).includes("placed:card-1,card-2")).toBe(true);
  });

  test("Retry sync resubmits the current visible scene after a persistence failure", async () => {
    const view = await renderCanvas();
    await view.findByTestId("excalidraw");
    mockSceneElements = [
      { ...makePlacedElement("card-1", 2), customData: () => undefined },
    ];

    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "emit change" }));
      await Promise.resolve();
    });
    await view.findByRole("button", { name: "Retry sync" });

    mockSceneElements = [
      { ...makePlacedElement("card-1", 3), x: 320 },
    ];
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Retry sync" }));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(
        inspectCanvasDocument(mockEnvelope.document).materialization.elements[0]
          ?.x,
      ).toBe(320);
    });
    expect(view.queryByRole("button", { name: "Retry sync" })).toBeNull();
  });

  test("remote Y.Doc transactions reconcile through Excalidraw without entering local undo", async () => {
    const view = await renderCanvas();
    await view.findByTestId("excalidraw");
    const callsBeforeRemote = updateSceneCalls.length;

    act(() => {
      applyCanvasSceneSnapshot(
        mockEnvelope,
        {
          elements: [
            {
              ...makePlacedElement("card-1", 2),
              x: 240,
            },
          ],
          appState: { gridModeEnabled: true },
          files: {},
        },
        "remote-window",
      );
    });

    await waitFor(() => {
      expect(updateSceneCalls.length > callsBeforeRemote).toBe(true);
    });
    const latest = updateSceneCalls[updateSceneCalls.length - 1];
    expect(latest?.captureUpdate).toBe("never");
    expect(mockSceneElements[0]?.x).toBe(240);
    expect(mockAppState.gridModeEnabled).toBe(true);
  });
});
