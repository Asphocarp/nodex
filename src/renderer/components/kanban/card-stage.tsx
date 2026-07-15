import {
  memo,
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import type * as Y from "yjs";
import type { Awareness } from "y-protocols/awareness";
import { NfmEditor } from "./editor/nfm-editor";
import { BlockDocumentSurface } from "@/components/block-documents/block-document-surface";
import { BlockDocumentSyncStatus } from "@/components/block-documents/block-document-sync-status";
import { CollaborativeCardTitle } from "@/components/block-documents/collaborative-card-title";
import { CardStageInlinePropertyStrip } from "./card-stage/inline-property-strip";
import { CardStageContentSkeleton } from "./card-stage/content-skeleton";
import { CardStagePropertiesSection } from "./card-stage/properties-section";
import { CardStageRawContent } from "./card-stage/raw-content";
import { CardStageToolbar } from "./card-stage/toolbar";
import { useCardStageController } from "./card-stage/use-card-stage-controller";
import type { CardStageProps } from "./card-stage/types";
import type { BlockDocumentSurfaceRuntime } from "@/lib/block-document-surface-runtime";
import { RIGHT_PANEL_COMPOSER_OVERLAY_SCROLL_RESERVE_STYLE } from "@/lib/right-panel-composer-overlay-reserve";
import { materializeCardDocument } from "../../../shared/block-documents/block-document-codec";

export type { CardStageProps } from "./card-stage/types";

export const CARD_STAGE_SCROLL_CONTAINER_TEST_ID =
  "card-stage-scroll-container";

const CARD_STAGE_SCROLL_CONTAINER_STYLE = {
  ...RIGHT_PANEL_COMPOSER_OVERLAY_SCROLL_RESERVE_STYLE,
  overflowAnchor: "none",
} satisfies CSSProperties;

interface CardStageDescriptionEditorProps {
  readonly projectId: string;
  readonly projectName?: string | null;
  readonly projectWorkspacePath?: string | null;
  readonly cardId: string;
  readonly showRawContent: boolean;
  readonly documentId: string;
  readonly generation: number;
  readonly document: Y.Doc;
  readonly body: Y.XmlFragment;
  readonly awareness: Awareness;
  readonly surfaceWriteFence: BlockDocumentSurfaceRuntime;
  readonly sessionId?: string | null;
  readonly sessionThread: CardStageProps["sessionThread"];
  readonly canStartThreadInSession: CardStageProps["canStartThreadInSession"];
  readonly linkedCodexThreads: CardStageProps["linkedCodexThreads"];
  readonly onOpenCodexThread: CardStageProps["onOpenCodexThread"];
  readonly onOpenCard: CardStageProps["onOpenCard"];
  readonly onStartNewSessionThreadFromEditor: CardStageProps["onStartNewSessionThreadFromEditor"];
  readonly onSendThreadSectionPrompt: CardStageProps["onSendThreadSectionPrompt"];
  readonly isActivePanelTab: boolean;
  readonly headingRailPortalElement: HTMLElement | null;
  readonly scrollContainerRef: RefObject<HTMLDivElement | null>;
}

const useLiveCardDocumentNfm = (document: Y.Doc): string => {
  const subscribe = useCallback(
    (listener: () => void) => {
      document.on("update", listener);
      return () => document.off("update", listener);
    },
    [document],
  );
  const getSnapshot = useCallback(
    () => materializeCardDocument(document).nfm,
    [document],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
};

function CollaborativeCardStageRawContent({
  document,
}: {
  readonly document: Y.Doc;
}) {
  return <CardStageRawContent content={useLiveCardDocumentNfm(document)} />;
}

const CardStageDescriptionEditor = memo(
  function CardStageDescriptionEditor({
    projectId,
    projectName,
    projectWorkspacePath,
    cardId,
    showRawContent,
    documentId,
    generation,
    document,
    body,
    awareness,
    surfaceWriteFence,
    sessionId,
    sessionThread,
    canStartThreadInSession,
    linkedCodexThreads,
    onOpenCodexThread,
    onOpenCard,
    onStartNewSessionThreadFromEditor,
    onSendThreadSectionPrompt,
    isActivePanelTab,
    headingRailPortalElement,
    scrollContainerRef,
  }: CardStageDescriptionEditorProps) {
    if (showRawContent) {
      return <CollaborativeCardStageRawContent document={document} />;
    }

    return (
      <NfmEditor
        projectId={projectId}
        projectName={projectName}
        projectWorkspacePath={projectWorkspacePath}
        source={{
          kind: "collaborative-document",
          documentId,
          storeEpoch: surfaceWriteFence.descriptor.storeEpoch,
          generation,
          clientSessionId: surfaceWriteFence.clientSessionId,
          fragment: body,
          user: { name: "You", color: "#3b82f6" },
          provider: { awareness },
        }}
        sourceCardContext={{ cardId }}
        surfaceWriteFence={surfaceWriteFence}
        sessionId={sessionId}
        sessionThread={sessionThread}
        canStartThreadInSession={canStartThreadInSession}
        linkedCodexThreads={linkedCodexThreads}
        onOpenCodexThread={onOpenCodexThread}
        onOpenCard={onOpenCard}
        onStartNewSessionThreadFromEditor={onStartNewSessionThreadFromEditor}
        onSendThreadSectionPrompt={onSendThreadSectionPrompt}
        isActivePanelTab={isActivePanelTab}
        headingRail={{
          portalElement: headingRailPortalElement,
          scrollContainerRef,
        }}
        placeholder="Add a description..."
      />
    );
  },
);

type CardStageController = ReturnType<typeof useCardStageController>;

interface CardStageContentProps {
  readonly controller: CardStageController;
  readonly title: ReactNode;
  readonly description: ReactNode;
  readonly syncStatus?: ReactNode;
}

function CardStageContent({
  controller,
  title,
  description,
  syncStatus,
}: CardStageContentProps) {
  return (
    <div className={controller.contentShellClassName}>
      <div className="h-toolbar-sm" />
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">{title}</div>
        {syncStatus ? <div className="shrink-0 pt-1">{syncStatus}</div> : null}
      </div>

      <div className="h-2" />

      {controller.hasDatabaseProperties ? (
        <CardStageInlinePropertyStrip
          priority={controller.priority}
          estimate={controller.estimate}
          dueDate={controller.dueDate}
          currentColumnId={controller.currentColumnId}
          currentColumnName={controller.currentColumnName}
          onPriorityChange={controller.handlePriorityChange}
          onEstimateChange={controller.handleEstimateChange}
          onDueDateChange={controller.handleDueDateChange}
          onClearDueDate={controller.handleClearDueDate}
          onSetDueDateToday={controller.handleSetDueDateToday}
          onColumnChange={controller.handleColumnChange}
        />
      ) : null}

      <CardStagePropertiesSection controller={controller} />

      <div className="pt-2 pb-8">{description}</div>
    </div>
  );
}

function CardStageDocumentTitle({
  title,
  surfaceWriteFence,
  onValueChange,
  onTitleSourceDispose,
}: {
  readonly title: Y.Text;
  readonly surfaceWriteFence: BlockDocumentSurfaceRuntime;
  readonly onValueChange: (title: string) => void;
  readonly onTitleSourceDispose?: () => void;
}) {
  const disposeTitleSource = useEffectEvent(() => {
    onTitleSourceDispose?.();
  });

  useEffect(() => () => {
    disposeTitleSource();
  }, [title]);

  return (
    <CollaborativeCardTitle
      title={title}
      surfaceWriteFence={surfaceWriteFence}
      onValueChange={onValueChange}
      onKeyDown={(event) => {
        if (event.key === "Enter" && !event.nativeEvent.isComposing) {
          event.preventDefault();
        }
      }}
    />
  );
}

export function CardStage(props: CardStageProps) {
  const documentRuntimeRef = useRef<BlockDocumentSurfaceRuntime | null>(null);
  const persistDocument = useCallback(async () => {
    const runtime = documentRuntimeRef.current;
    if (!runtime || runtime.getStatus().reloadRequired) return;
    try {
      await runtime.persist();
    } catch (error) {
      if (runtime.getStatus().reloadRequired) return;
      throw error;
    }
  }, []);
  const controller = useCardStageController(props, {
    persistDocument,
  });
  const [headingRailPortalElement, setHeadingRailPortalElement] =
    useState<HTMLDivElement | null>(null);

  if (!controller.card) return null;
  const card = controller.card;

  return (
    <div
      className="flex h-full w-full flex-col bg-(--background)"
      data-card-stage-surface="true"
    >
      <CardStageToolbar
        saving={controller.saving}
        historyPanelActive={controller.historyPanelActive}
        limitMainContentWidth={controller.limitMainContentWidth}
        showRawContent={controller.showRawContent}
        onClose={() => {
          void controller.handleClose();
        }}
        onDelete={() => {
          void controller.handleDelete();
        }}
        showDelete={Boolean(props.onDelete)}
        onToggleContentWidth={controller.handleToggleContentWidth}
        onToggleShowRawContent={controller.handleToggleShowRawContent}
        onToggleHistoryPanel={controller.onToggleHistoryPanel}
      />

      <div
        ref={setHeadingRailPortalElement}
        className="relative min-h-0 flex-1"
        data-card-stage-heading-navigation-portal-target="true"
      >
        <div
          ref={controller.setScrollContainerRef}
          onScroll={controller.handleScroll}
          className="scrollbar-token h-full min-h-0 overflow-y-auto"
          data-testid={CARD_STAGE_SCROLL_CONTAINER_TEST_ID}
          style={CARD_STAGE_SCROLL_CONTAINER_STYLE}
        >
          <div
            className={controller.contentBodyClassName}
            data-card-stage-body="true"
            data-card-stage-body-width={
              controller.limitMainContentWidth ? "constrained" : "full"
            }
          >
            <BlockDocumentSurface
              projectId={props.projectId}
              descriptor={props.documentAuthority.descriptor}
              isActive={props.isActivePanelTab ?? true}
              runtimeRef={documentRuntimeRef}
              onReload={props.documentAuthority.reload}
              dependencies={props.documentAuthority.surfaceDependencies}
              pendingFallback={
                <CardStageContentSkeleton titleSnapshot={card.title} />
              }
              localAwarenessState={{
                user: { name: "You", color: "#3b82f6" },
              }}
            >
              {(surface) => (
                <CardStageContent
                  controller={controller}
                  title={
                    <CardStageDocumentTitle
                      title={surface.title}
                      surfaceWriteFence={surface.runtime}
                      onValueChange={controller.handleDocumentTitleChange}
                      onTitleSourceDispose={props.onTitleSourceDispose}
                    />
                  }
                  syncStatus={
                    <BlockDocumentSyncStatus
                      runtime={surface.runtime}
                      status={surface.status.provider}
                    />
                  }
                  description={
                    <CardStageDescriptionEditor
                      projectId={props.projectId}
                      projectName={props.projectName}
                      projectWorkspacePath={props.projectWorkspacePath}
                      cardId={card.id}
                      showRawContent={controller.showRawContent}
                      documentId={surface.documentId}
                      generation={surface.descriptor.generation}
                      document={surface.document}
                      body={surface.body}
                      awareness={surface.awareness}
                      surfaceWriteFence={surface.runtime}
                      sessionId={props.sessionId}
                      sessionThread={props.sessionThread}
                      canStartThreadInSession={props.canStartThreadInSession}
                      linkedCodexThreads={props.linkedCodexThreads}
                      onOpenCodexThread={props.onOpenCodexThread}
                      onOpenCard={props.onOpenCard}
                      onStartNewSessionThreadFromEditor={
                        props.onStartNewSessionThreadFromEditor
                      }
                      onSendThreadSectionPrompt={
                        props.onSendThreadSectionPrompt
                      }
                      isActivePanelTab={props.isActivePanelTab ?? true}
                      headingRailPortalElement={headingRailPortalElement}
                      scrollContainerRef={controller.scrollContainerRef}
                    />
                  }
                />
              )}
            </BlockDocumentSurface>
          </div>
        </div>
      </div>
    </div>
  );
}
