import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
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
  RegisteredOwnedBlockDocumentBoundary,
  compactCanvasScene,
  createCanvasSceneSyncAdapter,
  createDefaultCanvasSceneOutbox,
  useKanban,
  useTheme,
  readCanvasSceneCompaction,
} from "./canvas-view-deps";
import {
  createPageElement,
  collectPlacedPageIds,
  isCardElement,
  getPageIdFromElement,
  getPageTitleHintFromElement,
  syncPlacedPageIds,
  updatePageElements,
} from "@/lib/canvas-card-elements";
import type { DatabasePageSummary } from "@/lib/types";
import { toDatabasePageSummary } from "../../../shared/page-summary";
import {
  primaryCanvasBlockId,
  type PortableCanvasScene,
} from "../../../shared/block-documents";
import {
  CanvasBinaryFileResolver,
  type CanvasBinaryFiles,
} from "@/lib/canvas-assets";
import { CanvasSceneBinding } from "@/lib/canvas-scene-binding";
import { CanvasSceneProvider } from "@/lib/canvas-scene-provider";
import { canvasSceneSurfaceRegistry } from "@/lib/canvas-scene-surface-runtime";
import type { ReadyRegisteredOwnedBlockDocumentDescriptor } from "@/lib/owned-block-document";
import { LayoutGrid } from "lucide-react";
import { CanvasDocumentState } from "./canvas-document-state";
import { CANVAS_SCENE_MAINTENANCE_VERSION } from "../../../shared/block-documents/canvas-scene-maintenance";
import {
  createCanvasPresenceController,
  type CanvasPresenceController,
} from "@/lib/canvas-presence-controller";
import {
  createCanvasViewportPersistence,
  readCanvasViewportPreference,
  type CanvasViewportPersistence,
} from "@/lib/canvas-viewport-preference";

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
  databaseViewId: string;
  canvasSurfaceKey: string;
  openPageStage: (
    projectId: string,
    pageId: string,
    titleSnapshot?: string,
  ) => void;
  pageStagePageId: string | undefined;
  pageStageCloseRef: RefObject<(() => Promise<void>) | null>;
}

export function CanvasView({ projectId, databaseViewId, canvasSurfaceKey, openPageStage, pageStagePageId, pageStageCloseRef }: CanvasViewProps) {
  return (
    <RegisteredOwnedBlockDocumentBoundary
      projectId={projectId}
      ownerBlockId={primaryCanvasBlockId(projectId)}
    >
      {(model, controls) => {
        if (model.status === "loading") {
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
        const descriptor = model.descriptor;
        if (descriptor.sync.kind !== "canvas_scene") {
          return (
            <CanvasDocumentState
              status="error"
              message="Canvas requires the scene-native sync engine"
              onRetry={() => void controls.reload()}
            />
          );
        }
        return (
          <CanvasEditor
            key={JSON.stringify([
              model.descriptor.storeEpoch,
              model.descriptor.documentId,
            ])}
            projectId={projectId}
            databaseViewId={databaseViewId}
            canvasSurfaceKey={canvasSurfaceKey}
            descriptor={descriptor as CanvasEditorProps["descriptor"]}
            onReload={controls.reload}
            openPageStage={openPageStage}
            pageStagePageId={pageStagePageId}
            pageStageCloseRef={pageStageCloseRef}
          />
        );
      }}
    </RegisteredOwnedBlockDocumentBoundary>
  );
}

interface CanvasEditorProps extends CanvasViewProps {
  readonly descriptor: ReadyRegisteredOwnedBlockDocumentDescriptor & {
    readonly sync: { readonly kind: "canvas_scene" };
  };
  readonly onReload: () => Promise<void>;
}

function CanvasEditor({
  projectId,
  databaseViewId,
  canvasSurfaceKey,
  descriptor,
  onReload,
  openPageStage,
  pageStagePageId,
  pageStageCloseRef,
}: CanvasEditorProps) {
  const {
    board,
    createPage,
  } = useKanban({ projectId, databaseViewId });
  const { resolved: themeResolved } = useTheme();
  const excalidrawApiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const bindingRef = useRef<CanvasSceneBinding | null>(null);
  const presenceRef = useRef<CanvasPresenceController | null>(null);
  const viewportPersistenceRef = useRef<CanvasViewportPersistence | null>(null);
  const clientSessionIdRef = useRef(
    `canvas:${globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36)}`,
  );
  const [restoredViewport] = useState(() =>
    readCanvasViewportPreference({
      storeEpoch: descriptor.storeEpoch,
      documentId: descriptor.documentId,
    }));
  const [resolvedScene, setResolvedScene] = useState<{
    readonly materialization: PortableCanvasScene;
    readonly files: CanvasBinaryFiles;
  } | null>(null);
  const [sceneError, setSceneError] = useState<string | null>(null);
  const retrySceneRef = useRef<(() => void) | null>(null);
  const latestElementsRef = useRef<readonly OrderedExcalidrawElement[]>([]);
  const [placedPageIds, setPlacedPageIds] = useState(() =>
    collectPlacedPageIds(latestElementsRef.current),
  );
  const [writeFrozen, setWriteFrozen] = useState(false);

  const handleExcalidrawAPI = useCallback((api: ExcalidrawImperativeAPI) => {
    excalidrawApiRef.current = api;
    const collaborators = presenceRef.current?.getCollaborators();
    if (!collaborators) return;
    void collaborationPromise.then(({ CaptureUpdateAction }) => {
      if (excalidrawApiRef.current !== api) return;
      api.updateScene({
        collaborators: new Map(collaborators),
        captureUpdate: CaptureUpdateAction.NEVER,
      });
    });
  }, []);

  const handleViewportChange = useCallback((
    scrollX: number,
    scrollY: number,
    zoom: AppState["zoom"],
  ) => {
    viewportPersistenceRef.current?.observe({
      scrollX,
      scrollY,
      zoom: zoom.value,
    });
  }, []);

  useLayoutEffect(() => {
    const persistence = createCanvasViewportPersistence({
      storeEpoch: descriptor.storeEpoch,
      documentId: descriptor.documentId,
    });
    viewportPersistenceRef.current = persistence;
    const flushCurrentViewport = (): void => {
      const appState = excalidrawApiRef.current?.getAppState();
      if (appState) {
        persistence.observe({
          scrollX: appState.scrollX,
          scrollY: appState.scrollY,
          zoom: appState.zoom.value,
        });
      }
      persistence.flush();
    };
    window.addEventListener("beforeunload", flushCurrentViewport);
    return () => {
      window.removeEventListener("beforeunload", flushCurrentViewport);
      flushCurrentViewport();
      persistence.dispose();
      if (viewportPersistenceRef.current === persistence) {
        viewportPersistenceRef.current = null;
      }
    };
  }, [descriptor.documentId, descriptor.storeEpoch]);

  useEffect(() => {
    let active = true;
    let presentationRevision = 0;
    const fileResolver = new CanvasBinaryFileResolver();
    let binding: CanvasSceneBinding | null = null;
    let presence: CanvasPresenceController | null = null;
    const provider = new CanvasSceneProvider({
      projectId,
      documentId: descriptor.documentId,
      clientSessionId: clientSessionIdRef.current,
      expectedStoreEpoch: descriptor.storeEpoch,
      expectedGeneration: descriptor.generation,
      adapter: createCanvasSceneSyncAdapter(projectId),
      outbox: createDefaultCanvasSceneOutbox(),
      onScene: (scene) => binding?.presentRemoteScene(scene),
      onPresence: (event) => presence?.receive(event),
    });
    const unsubscribeStatus = provider.subscribeStatus(() => {
      if (!active) return;
      const status = provider.getStatus();
      const frozen =
        status.writeFrozen
        || status.phase === "reset-required"
        || status.phase === "error"
        || status.phase === "closing"
        || status.phase === "closed";
      setWriteFrozen(frozen);
      presence?.setEnabled(
        !frozen
        && status.connected
        && (status.phase === "ready" || status.phase === "saving"),
      );
      if (status.error) setSceneError(status.error.message);
    });
    presence = createCanvasPresenceController({
      publish: provider.publishPresence,
      onCollaborators: (collaborators) => {
        if (!active) return;
        const api = excalidrawApiRef.current;
        if (!api) return;
        void collaborationPromise.then(({ CaptureUpdateAction }) => {
          if (!active || excalidrawApiRef.current !== api) return;
          api.updateScene({
            collaborators: new Map(collaborators),
            captureUpdate: CaptureUpdateAction.NEVER,
          });
        });
      },
    });
    presence.setEnabled(false);
    presenceRef.current = presence;
    const updateIdleState = (): void => {
      if (!presence) return;
      if (document.visibilityState === "hidden") {
        presence.setIdle("away");
        return;
      }
      presence.setIdle(document.hasFocus() ? "active" : "idle");
    };
    const handleWindowFocus = (): void => updateIdleState();
    const handleWindowBlur = (): void => updateIdleState();
    document.addEventListener("visibilitychange", updateIdleState);
    window.addEventListener("focus", handleWindowFocus);
    window.addEventListener("blur", handleWindowBlur);
    binding = new CanvasSceneBinding({
      provider,
      onRemoteScene: (scene) => {
        void presentScene(scene);
      },
      onError: (error) => {
        if (active) setSceneError(error.message);
      },
    });
    bindingRef.current = binding;
    const unregisterWriteLeasePreparer = provider.registerWriteLeasePreparer(
      binding.flushCommitted,
    );
    const runtime = canvasSceneSurfaceRegistry.acquire({
      key: canvasSurfaceKey,
      descriptor,
      provider,
      presence,
      binding,
      fileResolver,
      maintainIfIdle: async () => {
        const request = {
          version: CANVAS_SCENE_MAINTENANCE_VERSION,
          projectId,
          documentId: descriptor.documentId,
          clientSessionId: clientSessionIdRef.current,
        };
        const eligibility = await readCanvasSceneCompaction(request);
        if (!eligibility.ok || !eligibility.value.eligible) return;
        await compactCanvasScene({
          ...request,
          mutationId:
            globalThis.crypto?.randomUUID?.()
            ?? `canvas-maintenance:${Date.now().toString(36)}`,
          trigger: "automatic_idle",
        });
      },
      disposeSubscriptions: () => {
        unregisterWriteLeasePreparer();
        unsubscribeStatus();
        document.removeEventListener("visibilitychange", updateIdleState);
        window.removeEventListener("focus", handleWindowFocus);
        window.removeEventListener("blur", handleWindowBlur);
      },
    });

    async function presentScene(
      materialization: PortableCanvasScene,
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
        binding?.acceptRemotePresentation(reconciled);
        api.addFiles(Object.values(files) as unknown as BinaryFileData[]);
        api.updateScene({
          elements: reconciled,
          appState: materialization.appState as unknown as AppState,
          captureUpdate: collaboration.CaptureUpdateAction.NEVER,
        });
        latestElementsRef.current = reconciled;
        setPlacedPageIds((previous) =>
          syncPlacedPageIds(previous, reconciled),
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
      void (async () => {
        const api = excalidrawApiRef.current;
        const currentStatus = provider.getStatus();
        if (
          api
          && currentStatus.phase !== "reset-required"
          && currentStatus.phase !== "error"
        ) {
          await binding.submitLocalScene({
            elementsIncludingDeleted: api.getSceneElementsIncludingDeleted(),
            appState: api.getAppState() as unknown as Record<string, unknown>,
            binaryFiles: api.getFiles() as unknown as CanvasBinaryFiles,
          }).committed;
        }
        const status = provider.getStatus();
        if (status.phase === "reset-required" || status.phase === "error") {
          await onReload();
          return;
        }
        await provider.connect();
        await presentScene(binding.getCurrentScene());
      })().catch((error: unknown) => {
        if (!active) return;
        setSceneError(error instanceof Error ? error.message : String(error));
      });
    };
    retrySceneRef.current = retry;
    void runtime.connect().catch((error: unknown) => {
      if (active) setSceneError(error instanceof Error ? error.message : String(error));
    });

    return () => {
      active = false;
      if (retrySceneRef.current === retry) retrySceneRef.current = null;
      if (bindingRef.current === binding) bindingRef.current = null;
      if (presenceRef.current === presence) presenceRef.current = null;
      void canvasSceneSurfaceRegistry
        .release(canvasSurfaceKey, runtime)
        .catch(() => undefined);
    };
  }, [canvasSurfaceKey, descriptor, onReload, projectId]);

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
        const updated = updatePageElements(
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
        setPlacedPageIds((previous) =>
          syncPlacedPageIds(previous, nextElements),
        );
        await binding.submitLocalScene({
          elementsIncludingDeleted: nextElements,
          appState: api.getAppState() as unknown as Record<string, unknown>,
          binaryFiles: api.getFiles() as unknown as CanvasBinaryFiles,
        }).committed;
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
  // Clicking that badge fires onLinkOpen — we intercept to open the page-stage.
  const handleLinkOpen = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (element: any, event: any) => {
      if (!isCardElement(element)) return;
      event.preventDefault();

      const pageId = getPageIdFromElement(element);
      if (!pageId) return;

      // Toggle: clicking the already-peeked card closes it (matches board/list behavior)
      if (pageStagePageId === pageId) {
        await pageStageCloseRef.current?.();
        return;
      }

      openPageStage(projectId, pageId, getPageTitleHintFromElement(element));
    },
    [openPageStage, projectId, pageStageCloseRef, pageStagePageId],
  );

  // Place an existing card on the canvas
  const handlePlaceCard = useCallback(
    async (card: DatabasePageSummary) => {
      const api = excalidrawApiRef.current;
      const binding = bindingRef.current;
      if (!api || !binding || writeFrozen) return;
      const [convert, collaboration] = await Promise.all([
        convertPromise,
        collaborationPromise,
      ]);

      const skeleton = createPageElement(card, {
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
      setPlacedPageIds((previous) => syncPlacedPageIds(previous, nextElements));
      await binding.submitLocalScene({
        elementsIncludingDeleted: nextElements,
        appState: api.getAppState() as unknown as Record<string, unknown>,
        binaryFiles: api.getFiles() as unknown as CanvasBinaryFiles,
      }).committed;
    },
    [writeFrozen],
  );

  const handlePointerUpdate = useCallback((payload: {
    readonly pointer: {
      readonly x: number;
      readonly y: number;
      readonly tool: "pointer" | "laser";
    };
    readonly button: "down" | "up";
  }) => {
    presenceRef.current?.updatePointer({
      ...payload.pointer,
      button: payload.button,
    });
  }, []);

  // Create a new card and place it on canvas
  const handleCreateAndPlace = useCallback(async () => {
    if (!excalidrawApiRef.current) return;
    const card = await createPage("triage", { title: "New Page" });
    if (!card) return;
    await handlePlaceCard(toDatabasePageSummary(card));
  }, [createPage, handlePlaceCard]);

  // Excalidraw observations become mergeable scene mutations with explicit tombstones.
  const handleChange = useCallback(
    (
      elements: readonly OrderedExcalidrawElement[],
      appState: AppState,
      files: BinaryFiles,
    ) => {
      const api = excalidrawApiRef.current;
      const binding = bindingRef.current;
      presenceRef.current?.updateSelection(
        Object.entries(appState.selectedElementIds ?? {})
          .filter(([, selected]) => selected)
          .map(([elementId]) => elementId),
      );
      if (!api || !binding || writeFrozen) return;
      latestElementsRef.current = elements;
      setPlacedPageIds((previous) => syncPlacedPageIds(previous, elements));
      void binding
        .submitLocalScene({
          elementsIncludingDeleted: api.getSceneElementsIncludingDeleted(),
          appState: appState as unknown as Record<string, unknown>,
          binaryFiles: files as unknown as CanvasBinaryFiles,
        })
        .committed
        .catch((error: unknown) => {
          setSceneError(error instanceof Error ? error.message : String(error));
        });
    },
    [writeFrozen],
  );

  // Render top-right UI: card sidebar toggle button
  const renderTopRightUI = useCallback(() => {
    return (
      <button
        type="button"
        onClick={() =>
          excalidrawApiRef.current?.toggleSidebar({
            name: "cards",
            tab: "browse",
          })}
        className="excalidraw-button"
        title="Pages"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          padding: "6px 10px",
          fontSize: 13,
        }}
      >
        <LayoutGrid size={16} />
        Pages
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
                ...(restoredViewport
                  ? {
                      scrollX: restoredViewport.scrollX,
                      scrollY: restoredViewport.scrollY,
                      zoom: {
                        value: restoredViewport.zoom,
                      } as AppState["zoom"],
                    }
                  : {}),
                theme: themeResolved,
              },
              files: resolvedScene.files as unknown as BinaryFiles,
              scrollToContent: restoredViewport ? false : undefined,
            }}
            theme={themeResolved}
            isCollaborating
            viewModeEnabled={writeFrozen}
            onChange={handleChange}
            onScrollChange={handleViewportChange}
            onPointerUpdate={handlePointerUpdate}
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
              placedPageIds={placedPageIds}
              onPlaceCard={handlePlaceCard}
              onCreateAndPlace={handleCreateAndPlace}
            />
          </ExcalidrawLazy>
        </div>
      </Suspense>
    </div>
  );
}
