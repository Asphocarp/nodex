import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type {
  AppState,
  BinaryFileData,
  BinaryFiles,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";
import type { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import "@excalidraw/excalidraw/index.css";
import {
  loadCanvasCardSidebar,
  loadExcalidraw,
  OwnedBlockDocumentSurface,
  RegisteredOwnedBlockDocumentBoundary,
  useKanban,
  useTheme,
} from "./canvas-view-deps";
import {
  createCardElement,
  collectPlacedCardIds,
  isCardElement,
  getCardIdFromElement,
  getCardTitleHintFromElement,
  syncPlacedCardIds,
  updateCardElements,
} from "@/lib/canvas-card-elements";
import type { CardSummary } from "@/lib/types";
import { toCardSummary } from "../../../shared/card-summary";
import {
  inspectCanvasDocument,
  primaryCanvasBlockId,
  type CanvasDocumentEnvelope,
  type CanvasSceneMaterialization,
} from "../../../shared/block-documents";
import {
  CanvasBinaryFileResolver,
  type CanvasBinaryFiles,
} from "@/lib/canvas-assets";
import { CanvasSceneBinding } from "@/lib/canvas-scene-binding";
import type { BlockDocumentSurfaceRuntime } from "@/lib/block-document-surface-runtime";
import { LayoutGrid } from "lucide-react";
import { CanvasDocumentState } from "./canvas-document-state";

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

const collaborationPromise = loadExcalidraw().then((mod) => ({
  reconcileElements: mod.reconcileElements,
  CaptureUpdateAction: mod.CaptureUpdateAction,
  newElementWith: mod.newElementWith,
}));

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
  return (
    <RegisteredOwnedBlockDocumentBoundary
      projectId={projectId}
      ownerBlockId={primaryCanvasBlockId(projectId)}
    >
      {(model, controls) => {
        if (model.status === "loading" || model.status === "legacy_shadow") {
          return <CanvasDocumentState status="loading" label="Opening canvas…" />;
        }
        if (model.status === "error") {
          return (
            <CanvasDocumentState
              status="error"
              message={model.error.message}
              onRetry={() => void controls.reload()}
            />
          );
        }
        return (
          <OwnedBlockDocumentSurface
            projectId={projectId}
            descriptor={model.descriptor}
            isActive
            localAwarenessState={{ surface: "canvas" }}
            onReload={controls.reload}
          >
            {(surface) => {
              if (surface.kind !== "scene_graph") {
                throw new TypeError("Canvas owner resolved a non-scene Document");
              }
              return (
                <CanvasEditor
                  key={surface.documentId}
                  projectId={projectId}
                  envelope={surface}
                  runtime={surface.runtime}
                  openCardStage={openCardStage}
                  cardStageCardId={cardStageCardId}
                  cardStageCloseRef={cardStageCloseRef}
                />
              );
            }}
          </OwnedBlockDocumentSurface>
        );
      }}
    </RegisteredOwnedBlockDocumentBoundary>
  );
}

interface CanvasEditorProps extends CanvasViewProps {
  readonly envelope: CanvasDocumentEnvelope;
  readonly runtime: BlockDocumentSurfaceRuntime;
}

function CanvasEditor({
  projectId,
  envelope,
  runtime,
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
  const bindingRef = useRef<CanvasSceneBinding | null>(null);
  const [resolvedScene, setResolvedScene] = useState<{
    readonly materialization: CanvasSceneMaterialization;
    readonly files: CanvasBinaryFiles;
  } | null>(null);
  const [sceneError, setSceneError] = useState<string | null>(null);
  const retrySceneRef = useRef<(() => void) | null>(null);
  const latestElementsRef = useRef<readonly OrderedExcalidrawElement[]>(
    inspectCanvasDocument(envelope.document).materialization
      .elements as readonly OrderedExcalidrawElement[],
  );
  const [placedCardIds, setPlacedCardIds] = useState(() =>
    collectPlacedCardIds(latestElementsRef.current),
  );
  const writeFrozen = runtime.getStatus().writeFrozen;

  const handleExcalidrawAPI = useCallback((api: ExcalidrawImperativeAPI) => {
    excalidrawApiRef.current = api;
  }, []);

  useEffect(() => {
    let active = true;
    let presentationRevision = 0;
    const fileResolver = new CanvasBinaryFileResolver();
    const binding = new CanvasSceneBinding({
      envelope,
      onRemoteScene: (scene) => {
        void presentScene(scene);
      },
      onError: (error) => {
        if (active) setSceneError(error.message);
      },
    });
    const unregisterPreparers = binding.registerSurfacePreparers(runtime);
    bindingRef.current = binding;

    async function presentScene(
      materialization: CanvasSceneMaterialization,
    ): Promise<void> {
      const revision = ++presentationRevision;
      try {
        const [files, collaboration] = await Promise.all([
          fileResolver.resolve(materialization.files),
          collaborationPromise,
        ]);
        if (!active || revision !== presentationRevision) return;

        const api = excalidrawApiRef.current;
        if (!api) {
          setResolvedScene({ materialization, files });
          setSceneError(null);
          return;
        }

        const localElements = api.getSceneElementsIncludingDeleted();
        const remoteElements = materialization.elements as unknown as Parameters<
          typeof collaboration.reconcileElements
        >[1];
        const reconciled = collaboration.reconcileElements(
          localElements,
          remoteElements,
          api.getAppState(),
        );
        api.addFiles(Object.values(files) as unknown as BinaryFileData[]);
        api.updateScene({
          elements: reconciled,
          appState: materialization.appState as unknown as AppState,
          captureUpdate: collaboration.CaptureUpdateAction.NEVER,
        });
        latestElementsRef.current = reconciled;
        setPlacedCardIds((previous) =>
          syncPlacedCardIds(previous, reconciled),
        );
        setResolvedScene({ materialization, files });
        setSceneError(null);
      } catch (error) {
        if (!active || revision !== presentationRevision) return;
        setSceneError(
          error instanceof Error ? error.message : String(error),
        );
      }
    }

    const retry = (): void => {
      void presentScene(binding.getCurrentScene());
    };
    retrySceneRef.current = retry;
    retry();

    return () => {
      active = false;
      if (retrySceneRef.current === retry) retrySceneRef.current = null;
      fileResolver.destroy();
      if (bindingRef.current === binding) bindingRef.current = null;
      void binding
        .flush()
        .catch(() => undefined)
        .finally(() => {
          unregisterPreparers();
          binding.destroy();
        });
    };
  }, [envelope.document, envelope.documentId, runtime]);

  // Sync card labels when board changes
  useEffect(() => {
    const api = excalidrawApiRef.current;
    const binding = bindingRef.current;
    if (!api || !binding || !board || writeFrozen) return;
    let active = true;

    void collaborationPromise
      .then(async ({ CaptureUpdateAction, newElementWith }) => {
        if (!active) return;
        const elements = api.getSceneElementsIncludingDeleted();
        const updated = updateCardElements(
          elements as readonly Record<string, unknown>[],
          board,
          (element, changes) =>
            newElementWith(
              element as unknown as OrderedExcalidrawElement,
              changes as never,
            ) as unknown as Record<string, unknown>,
        );
        if (!updated || !active) return;

        const nextElements = updated as unknown as readonly OrderedExcalidrawElement[];
        latestElementsRef.current = nextElements;
        api.updateScene({
          elements: nextElements,
          captureUpdate: CaptureUpdateAction.NEVER,
        });
        setPlacedCardIds((previous) =>
          syncPlacedCardIds(previous, nextElements),
        );
        await binding.submitLocalScene({
          getSceneElementsIncludingDeleted: () => nextElements,
          appState: api.getAppState() as unknown as Record<string, unknown>,
          binaryFiles: api.getFiles() as unknown as CanvasBinaryFiles,
        });
      })
      .catch((error: unknown) => {
        if (active) {
          setSceneError(error instanceof Error ? error.message : String(error));
        }
      });

    return () => {
      active = false;
    };
  }, [board, resolvedScene, writeFrozen]);

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

      openCardStage(projectId, cardId, getCardTitleHintFromElement(element));
    },
    [openCardStage, projectId, cardStageCloseRef, cardStageCardId],
  );

  // Place an existing card on the canvas
  const handlePlaceCard = useCallback(
    async (card: CardSummary) => {
      const api = excalidrawApiRef.current;
      const binding = bindingRef.current;
      if (!api || !binding || runtime.getWriteFrozen()) return;
      const [convert, collaboration] = await Promise.all([
        convertPromise,
        collaborationPromise,
      ]);

      const skeleton = createCardElement(card, {
        x: 100 + Math.random() * 300,
        y: 100 + Math.random() * 300,
      });
      const elements = convert([skeleton] as Parameters<typeof convert>[0]);
      const existing = api.getSceneElementsIncludingDeleted();
      const nextElements = [...existing, ...elements] as readonly OrderedExcalidrawElement[];
      latestElementsRef.current = nextElements;
      api.updateScene({
        elements: nextElements,
        captureUpdate: collaboration.CaptureUpdateAction.IMMEDIATELY,
      });
      setPlacedCardIds((previous) => syncPlacedCardIds(previous, nextElements));
      await binding.submitLocalScene({
        getSceneElementsIncludingDeleted: () => nextElements,
        appState: api.getAppState() as unknown as Record<string, unknown>,
        binaryFiles: api.getFiles() as unknown as CanvasBinaryFiles,
      });
    },
    [runtime],
  );

  // Create a new card and place it on canvas
  const handleCreateAndPlace = useCallback(async () => {
    if (!excalidrawApiRef.current) return;
    const card = await createCard("draft", { title: "New Card" });
    if (!card) return;
    await handlePlaceCard(toCardSummary(card));
  }, [createCard, handlePlaceCard]);

  // Excalidraw observations update the Canvas-owned Y.Doc, never a whole-scene row.
  const handleChange = useCallback(
    (
      elements: readonly OrderedExcalidrawElement[],
      appState: AppState,
      files: BinaryFiles,
    ) => {
      const api = excalidrawApiRef.current;
      const binding = bindingRef.current;
      if (!api || !binding || runtime.getWriteFrozen()) return;
      latestElementsRef.current = elements;
      setPlacedCardIds((previous) => syncPlacedCardIds(previous, elements));
      void binding
        .submitLocalScene({
          getSceneElementsIncludingDeleted:
            () => api.getSceneElementsIncludingDeleted(),
          appState: appState as unknown as Record<string, unknown>,
          binaryFiles: files as unknown as CanvasBinaryFiles,
        })
        .catch((error: unknown) => {
          setSceneError(error instanceof Error ? error.message : String(error));
        });
    },
    [runtime],
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

  if (!resolvedScene) {
    if (!sceneError) {
      return (
        <CanvasDocumentState status="loading" label="Opening canvas assets…" />
      );
    }
    return (
      <CanvasDocumentState
        status="error"
        message={sceneError}
        onRetry={() => retrySceneRef.current?.()}
      />
    );
  }

  return (
    <div className="h-full min-h-0 w-full px-4 pb-4">
      {sceneError ? (
        <div
          role="alert"
          className="mb-2 flex items-center justify-between gap-3 text-xs text-(--foreground-secondary)"
        >
          <span className="truncate">{sceneError}</span>
          <button
            type="button"
            className="shrink-0 text-(--foreground) underline"
            onClick={() => retrySceneRef.current?.()}
          >
            Retry sync
          </button>
        </div>
      ) : null}
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
              elements: resolvedScene.materialization.elements as unknown as readonly OrderedExcalidrawElement[],
              appState: {
                ...resolvedScene.materialization.appState,
                theme: themeResolved,
              },
              files: resolvedScene.files as unknown as BinaryFiles,
            }}
            theme={themeResolved}
            viewModeEnabled={writeFrozen}
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
