import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type {
  AppState,
  BinaryFiles,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";
import type { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import "@excalidraw/excalidraw/index.css";
import {
  loadCanvasCardSidebar,
  loadExcalidraw,
  useCanvasState,
  useKanban,
  useTheme,
  type CanvasInitialData,
} from "./canvas-view-deps";
import {
  createCardElement,
  collectPlacedCardIds,
  isCardElement,
  getCardIdFromElement,
  syncPlacedCardIds,
  updateCardElements,
} from "@/lib/canvas-card-elements";
import type { CardSummary } from "@/lib/types";
import { toCardSummary } from "../../../shared/card-summary";
import { LayoutGrid } from "lucide-react";

const ExcalidrawLazy = lazy(async () => {
  const mod = await loadExcalidraw();
  return { default: mod.Excalidraw };
});

const CanvasCardSidebarLazy = lazy(async () => {
  const mod = await loadCanvasCardSidebar();
  return { default: mod.CanvasCardSidebar };
});

// Lazy-load convertToExcalidrawElements alongside Excalidraw
const convertPromise = loadExcalidraw().then(
  (mod) => mod.convertToExcalidrawElements,
);

interface CanvasViewProps {
  projectId: string;
  openCardStage: (
    projectId: string,
    cardId: string,
    titleSnapshot?: string,
  ) => void;
  cardStageCardId: string | undefined;
  cardStageCloseRef: RefObject<(() => Promise<void>) | null>;
}

export function CanvasView({ projectId, openCardStage, cardStageCardId, cardStageCloseRef }: CanvasViewProps) {
  const { initialData, isLoading, saveCanvas } = useCanvasState({ projectId });

  if (isLoading || !initialData || initialData.projectId !== projectId) {
    return (
      <div className="flex h-full flex-1 items-center justify-center">
        <div className="text-sm text-(--foreground-secondary)">Loading canvas...</div>
      </div>
    );
  }

  return (
    <CanvasEditor
      key={projectId}
      projectId={projectId}
      initialData={initialData}
      saveCanvas={saveCanvas}
      openCardStage={openCardStage}
      cardStageCardId={cardStageCardId}
      cardStageCloseRef={cardStageCloseRef}
    />
  );
}

interface CanvasEditorProps extends CanvasViewProps {
  initialData: CanvasInitialData;
  saveCanvas: (
    elements: readonly unknown[],
    appState: Record<string, unknown>,
    files: Record<string, unknown> | undefined,
  ) => void;
}

function CanvasEditor({
  projectId,
  initialData,
  saveCanvas,
  openCardStage,
  cardStageCardId,
  cardStageCloseRef,
}: CanvasEditorProps) {
  const {
    board,
    createCard,
  } = useKanban({ projectId });
  const { resolved: themeResolved } = useTheme();
  const excalidrawApiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const latestElementsRef = useRef<readonly OrderedExcalidrawElement[]>(
    initialData.elements as readonly OrderedExcalidrawElement[],
  );
  const [placedCardIds, setPlacedCardIds] = useState(() => collectPlacedCardIds(initialData.elements));

  const handleExcalidrawAPI = useCallback((api: ExcalidrawImperativeAPI) => {
    excalidrawApiRef.current = api;
  }, []);

  // Sync card labels when board changes
  useEffect(() => {
    const api = excalidrawApiRef.current;
    if (!api || !board) return;

    const elements = latestElementsRef.current as readonly Record<string, unknown>[];
    const updated = updateCardElements(elements, board);
    if (!updated) return;

    const nextElements = updated as unknown as readonly OrderedExcalidrawElement[];
    latestElementsRef.current = nextElements;
    api.updateScene({ elements: nextElements });
    setPlacedCardIds((previous) => syncPlacedCardIds(previous, nextElements));
  }, [board]);

  // Find card + column from board by cardId
  const findCard = useCallback(
    (cardId: string) => {
      if (!board) return null;
      for (const col of board.columns) {
        const card = col.cards.find((c) => c.id === cardId);
        if (card) return { card, columnId: col.id };
      }
      return null;
    },
    [board],
  );

  // Excalidraw renders a native link badge on elements with a `link` property.
  // Clicking that badge fires onLinkOpen — we intercept to open the card-stage.
  const handleLinkOpen = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (element: any, event: any) => {
      if (!isCardElement(element)) return;
      event.preventDefault();

      const cardId = getCardIdFromElement(element);
      if (!cardId) return;

      // Toggle: clicking the already-peeked card closes it (matches board/list behavior)
      if (cardStageCardId === cardId) {
        await cardStageCloseRef.current?.();
        return;
      }

      const found = findCard(cardId);
      if (!found) return;

      openCardStage(projectId, cardId, found.card.title);
    },
    [findCard, openCardStage, projectId, cardStageCloseRef, cardStageCardId],
  );

  // Place an existing card on the canvas
  const handlePlaceCard = useCallback(
    async (card: CardSummary, columnId: string) => {
      const api = excalidrawApiRef.current;
      if (!api) return;
      const convert = await convertPromise;

      const skeleton = createCardElement(card, columnId, {
        x: 100 + Math.random() * 300,
        y: 100 + Math.random() * 300,
      });
      const elements = convert([skeleton] as Parameters<typeof convert>[0]);
      const existing = api.getSceneElements();
      const nextElements = [...existing, ...elements] as readonly OrderedExcalidrawElement[];
      latestElementsRef.current = nextElements;
      api.updateScene({ elements: nextElements });
      setPlacedCardIds((previous) => syncPlacedCardIds(previous, nextElements));
    },
    [],
  );

  // Create a new card and place it on canvas
  const handleCreateAndPlace = useCallback(async () => {
    if (!excalidrawApiRef.current) return;
    const card = await createCard("draft", { title: "New Card" });
    if (!card) return;
    await handlePlaceCard(toCardSummary(card), "draft");
  }, [createCard, handlePlaceCard]);

  // onChange handler: debounced save
  const handleChange = useCallback(
    (
      elements: readonly OrderedExcalidrawElement[],
      appState: AppState,
      files: BinaryFiles,
    ) => {
      latestElementsRef.current = elements;
      setPlacedCardIds((previous) => syncPlacedCardIds(previous, elements));
      saveCanvas(
        elements,
        appState as unknown as Record<string, unknown>,
        files as unknown as Record<string, unknown>,
      );
    },
    [saveCanvas],
  );

  // Render top-right UI: card sidebar toggle button
  const renderTopRightUI = useCallback(() => {
    return (
      <button
        type="button"
        onClick={() => excalidrawApiRef.current?.toggleSidebar({ name: "cards", tab: "browse" })}
        className="excalidraw-button"
        title="Cards"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          padding: "6px 10px",
          fontSize: 13,
        }}
      >
        <LayoutGrid size={16} />
        Cards
      </button>
    );
  }, []);

  return (
    <div className="h-full min-h-0 w-full px-4 pb-4">
      <Suspense
        fallback={
          <div className="flex h-full flex-1 items-center justify-center">
            <div className="text-sm text-(--foreground-secondary)">Loading Excalidraw...</div>
          </div>
        }
      >
        <div className="h-full min-h-0 overflow-hidden rounded-lg border border-(--border)">
          <ExcalidrawLazy
            excalidrawAPI={handleExcalidrawAPI}
            initialData={{
              elements: initialData.elements as readonly OrderedExcalidrawElement[],
              appState: {
                ...initialData.appState,
                theme: themeResolved,
              },
              files: initialData.files as BinaryFiles,
            }}
            theme={themeResolved}
            onChange={handleChange}
            onLinkOpen={handleLinkOpen}
            renderTopRightUI={renderTopRightUI}
            UIOptions={{
              canvasActions: {
                loadScene: false,
              },
            }}
          >
            <CanvasCardSidebarLazy
              board={board}
              placedCardIds={placedCardIds}
              onPlaceCard={handlePlaceCard}
              onCreateAndPlace={handleCreateAndPlace}
            />
          </ExcalidrawLazy>
        </div>
      </Suspense>
    </div>
  );
}
