import { beforeEach, describe, expect, mock, test } from "bun:test";
import { act, fireEvent, waitFor } from "@testing-library/react";
import { createElement, StrictMode } from "react";
import type { ReactNode } from "react";
import type { BoardSummary, CardSummary } from "@/lib/types";
import { render, settleAsyncRender, textContent } from "@/test/dom";

type MockCanvasElement = {
  id: string;
  type: string;
  backgroundColor?: string;
  customData?: Record<string, unknown>;
  label?: { text: string };
};

let mockInitialElements: MockCanvasElement[] = [];
let mockSceneElements: MockCanvasElement[] = [];
let latestOnChange:
  | ((elements: readonly MockCanvasElement[], appState: Record<string, unknown>, files: Record<string, unknown>) => void)
  | null = null;
let toggleSidebarCalls = 0;
let updateSceneCalls = 0;
let saveCalls: Array<{
  elements: readonly unknown[];
  appState: Record<string, unknown>;
  files: Record<string, unknown> | undefined;
}> = [];
let sidebarRenderCount = 0;

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

function makePlacedElement(cardId: string): MockCanvasElement {
  const title = cardId === "card-2" ? "Two" : "One";
  return {
    id: `element-${cardId}`,
    type: "rectangle",
    backgroundColor: "#f8f9fa",
    customData: {
      type: "nodex-card",
      cardId,
      columnId: "draft",
    },
    label: { text: title },
  };
}

function MockExcalidraw(props: {
  excalidrawAPI?: (api: unknown) => void;
  onChange?: (elements: readonly MockCanvasElement[], appState: Record<string, unknown>, files: Record<string, unknown>) => void;
  renderTopRightUI?: () => ReactNode;
  children?: ReactNode;
}) {
  props.excalidrawAPI?.({
    getSceneElements: () => mockSceneElements,
    updateScene: ({ elements }: { elements?: readonly MockCanvasElement[] }) => {
      updateSceneCalls += 1;
      if (elements) mockSceneElements = [...elements];
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
        onClick: () => latestOnChange?.(mockSceneElements, {}, {}),
      },
      "emit change",
    ),
    props.children,
  );
}

mock.module("@excalidraw/excalidraw/index.css", () => ({}));

mock.module("./canvas-view-deps", () => ({
  loadExcalidraw: async () => ({
    Excalidraw: MockExcalidraw,
    convertToExcalidrawElements: (skeletons: readonly MockCanvasElement[]) => skeletons,
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
  useCanvasState: ({ projectId }: { projectId: string }) => ({
    initialData: {
      projectId,
      elements: mockInitialElements,
      appState: {},
      files: {},
    },
    isLoading: false,
    saveCanvas: (
      elements: readonly unknown[],
      appState: Record<string, unknown>,
      files: Record<string, unknown> | undefined,
    ) => {
      saveCalls.push({ elements, appState, files });
    },
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
    openCardStage: () => undefined,
    cardStageCardId: undefined,
    cardStageCloseRef: { current: null },
  });

  return render(strict ? createElement(StrictMode, null, canvas) : canvas);
}

describe("CanvasView", () => {
  beforeEach(() => {
    mockInitialElements = [makePlacedElement("card-1")];
    mockSceneElements = [makePlacedElement("card-1")];
    latestOnChange = null;
    toggleSidebarCalls = 0;
    updateSceneCalls = 0;
    saveCalls = [];
    sidebarRenderCount = 0;
  });

  test("does not loop when Excalidraw provides the API during initial render", async () => {
    const view = await renderCanvas(true);

    await waitFor(() => {
      expect(view.getByTestId("excalidraw").getAttribute("data-testid")).toBe("excalidraw");
    });
  });

  test("Cards button toggles the Excalidraw sidebar through the imperative API", async () => {
    const view = await renderCanvas();

    await waitFor(() => {
      expect(view.getByRole("button", { name: "Cards" }).textContent).toBe("Cards");
    });
    fireEvent.click(view.getByRole("button", { name: "Cards" }));

    expect(toggleSidebarCalls).toBe(1);
  });

  test("onChange saves every scene but only rerenders sidebar when placed card IDs change", async () => {
    const view = await renderCanvas();
    await settleAsyncRender();

    const initialSidebarRenderCount = sidebarRenderCount;
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "emit change" }));
      await Promise.resolve();
    });

    expect(saveCalls.length).toBe(1);
    expect(sidebarRenderCount).toBe(initialSidebarRenderCount);

    mockSceneElements = [makePlacedElement("card-1"), makePlacedElement("card-2")];
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "emit change" }));
      await Promise.resolve();
    });
    await settleAsyncRender();

    expect(saveCalls.length).toBe(2);
    expect(sidebarRenderCount > initialSidebarRenderCount).toBeTrue();
    expect(textContent(view.container).includes("placed:card-1,card-2")).toBeTrue();
    expect(updateSceneCalls).toBe(0);
  });
});
