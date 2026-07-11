import {
  memo,
  useCallback,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type MutableRefObject,
  type ReactNode,
  type RefObject,
} from "react";
import type * as Y from "yjs";
import type { Awareness } from "y-protocols/awareness.js";
import { NfmEditor } from "./editor/nfm-editor";
import { BlockDocumentSurface } from "@/components/block-documents/block-document-surface";
import { BlockDocumentSyncStatus } from "@/components/block-documents/block-document-sync-status";
import { CollaborativeCardTitle } from "@/components/block-documents/collaborative-card-title";
import { cn } from "@/lib/utils";
import { CardStageInlinePropertyStrip } from "./card-stage/inline-property-strip";
import { CardStagePropertiesSection } from "./card-stage/properties-section";
import { CardStageRawContent } from "./card-stage/raw-content";
import { CardStageToolbar } from "./card-stage/toolbar";
import { useCardStageController } from "./card-stage/use-card-stage-controller";
import type { CardStageDescriptionFlushHandle, CardStageProps } from "./card-stage/types";
import type { BlockDocumentSurfaceRuntime } from "@/lib/block-document-surface-runtime";
import { RIGHT_PANEL_COMPOSER_OVERLAY_SCROLL_RESERVE_STYLE } from "@/lib/right-panel-composer-overlay-reserve";
import { materializeCardDocument } from "../../../shared/block-documents/block-document-codec";

export type { CardStageProps } from "./card-stage/types";

export const CARD_STAGE_SCROLL_CONTAINER_TEST_ID = "card-stage-scroll-container";

const CARD_STAGE_SCROLL_CONTAINER_STYLE = {
  ...RIGHT_PANEL_COMPOSER_OVERLAY_SCROLL_RESERVE_STYLE,
  overflowAnchor: "none",
} satisfies CSSProperties;

interface CardStageDescriptionEditorProps {
  projectId: string;
  projectName?: string | null;
  projectWorkspacePath?: string | null;
  cardId: string;
  columnId: string;
  content: string;
  showRawContent: boolean;
  onChange: (value: string) => void;
  onPendingChange: () => void;
  onBlur: () => void;
  flushHandleRef: MutableRefObject<CardStageDescriptionFlushHandle | null>;
  sessionId?: string | null;
  sessionThread: CardStageProps["sessionThread"];
  canStartThreadInSession: CardStageProps["canStartThreadInSession"];
  linkedCodexThreads: CardStageProps["linkedCodexThreads"];
  onOpenCodexThread: CardStageProps["onOpenCodexThread"];
  onOpenCard: CardStageProps["onOpenCard"];
  onStartNewSessionThreadFromEditor: CardStageProps["onStartNewSessionThreadFromEditor"];
  onSendThreadSectionPrompt: CardStageProps["onSendThreadSectionPrompt"];
  isActivePanelTab: boolean;
  headingRailPortalElement: HTMLElement | null;
  scrollContainerRef: RefObject<HTMLDivElement | null>;
}

const LegacyCardStageDescriptionEditor = memo(function LegacyCardStageDescriptionEditor({
  projectId,
  projectName,
  projectWorkspacePath,
  cardId,
  columnId,
  content,
  showRawContent,
  onChange,
  onPendingChange,
  onBlur,
  flushHandleRef,
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
    return <CardStageRawContent content={content} />;
  }

  return (
    <NfmEditor
      key={`${projectId}:${cardId}`}
      projectId={projectId}
      projectName={projectName}
      projectWorkspacePath={projectWorkspacePath}
      source={{
        kind: "legacy-snapshot",
        content,
        onChange,
        onPendingChange,
        onBlur,
        flushHandleRef,
      }}
      sourceCardContext={{
        cardId,
        columnId,
      }}
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
});

type CollaborativeCardStageDescriptionEditorProps = Omit<
  CardStageDescriptionEditorProps,
  | "content"
  | "onChange"
  | "onPendingChange"
  | "onBlur"
  | "flushHandleRef"
> & {
  readonly documentId: string;
  readonly generation: number;
  readonly document: Y.Doc;
  readonly body: Y.XmlFragment;
  readonly awareness: Awareness;
};

const useLiveCardDocumentNfm = (document: Y.Doc): string => {
  const subscribe = useCallback((listener: () => void) => {
    document.on("update", listener);
    return () => document.off("update", listener);
  }, [document]);
  const getSnapshot = useCallback(
    () => materializeCardDocument(document).nfm,
    [document],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
};

function CollaborativeCardStageRawContent({ document }: { readonly document: Y.Doc }) {
  return <CardStageRawContent content={useLiveCardDocumentNfm(document)} />;
}

const CollaborativeCardStageDescriptionEditor = memo(
  function CollaborativeCardStageDescriptionEditor({
    projectId,
    projectName,
    projectWorkspacePath,
    cardId,
    columnId,
    showRawContent,
    documentId,
    generation,
    document,
    body,
    awareness,
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
  }: CollaborativeCardStageDescriptionEditorProps) {
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
          generation,
          fragment: body,
          user: { name: "You", color: "#3b82f6" },
          provider: { awareness },
        }}
        sourceCardContext={{ cardId, columnId }}
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

      <CardStagePropertiesSection controller={controller} />

      <div className="pt-2 pb-8">{description}</div>
    </div>
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
    persistDocument: props.documentAuthority.kind === "ydoc_primary"
      ? persistDocument
      : undefined,
  });
  const [headingRailPortalElement, setHeadingRailPortalElement] = useState<HTMLDivElement | null>(null);

  if (!controller.card) return null;
  const card = controller.card;

  return (
    <div className="flex h-full w-full flex-col bg-(--background)" data-card-stage-surface="true">
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
        onToggleContentWidth={controller.handleToggleContentWidth}
        onToggleShowRawContent={controller.handleToggleShowRawContent}
        onToggleHistoryPanel={controller.onToggleHistoryPanel}
      />

      {controller.updateConflict ? (
        <div className="mx-4 mt-3 rounded-md border border-(--orange-border) bg-(--orange-bg)/50 px-3 py-2 text-sm text-(--foreground)">
          <div className="flex items-center justify-between gap-3">
            <p className="text-(--foreground-secondary)">
              This card changed in another window. Choose how to proceed.
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={controller.handleReloadLatest}
                className="rounded-sm border border-(--border) px-2 py-1 text-xs hover:bg-(--surface-hover)"
              >
                Reload Latest
              </button>
              <button
                type="button"
                onClick={() => {
                  void controller.handleOverwriteMine();
                }}
                className="rounded-sm bg-(--foreground) px-2 py-1 text-xs text-(--background) hover:opacity-90"
              >
                Overwrite Mine
              </button>
            </div>
          </div>
        </div>
      ) : null}

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
            data-card-stage-body-width={controller.limitMainContentWidth ? "constrained" : "full"}
          >
            {props.documentAuthority.kind === "ydoc_primary" ? (
              <BlockDocumentSurface
                projectId={props.projectId}
                descriptor={props.documentAuthority.descriptor}
                isActive={props.isActivePanelTab ?? true}
                runtimeRef={documentRuntimeRef}
                onReload={props.documentAuthority.reload}
                localAwarenessState={{
                  user: { name: "You", color: "#3b82f6" },
                }}
              >
                {(surface) => (
                  <CardStageContent
                    controller={controller}
                    title={(
                      <CollaborativeCardTitle
                        title={surface.title}
                        onValueChange={controller.handleDocumentTitleChange}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                            event.preventDefault();
                          }
                        }}
                      />
                    )}
                    syncStatus={(
                      <BlockDocumentSyncStatus
                        runtime={surface.runtime}
                        status={surface.status.provider}
                      />
                    )}
                    description={(
                      <CollaborativeCardStageDescriptionEditor
                        projectId={props.projectId}
                        projectName={props.projectName}
                        projectWorkspacePath={props.projectWorkspacePath}
                        cardId={card.id}
                        columnId={controller.currentColumnId}
                        showRawContent={controller.showRawContent}
                        documentId={surface.documentId}
                        generation={surface.descriptor.generation}
                        document={surface.document}
                        body={surface.body}
                        awareness={surface.awareness}
                        sessionId={props.sessionId}
                        sessionThread={props.sessionThread}
                        canStartThreadInSession={props.canStartThreadInSession}
                        linkedCodexThreads={props.linkedCodexThreads}
                        onOpenCodexThread={props.onOpenCodexThread}
                        onOpenCard={props.onOpenCard}
                        onStartNewSessionThreadFromEditor={props.onStartNewSessionThreadFromEditor}
                        onSendThreadSectionPrompt={props.onSendThreadSectionPrompt}
                        isActivePanelTab={props.isActivePanelTab ?? true}
                        headingRailPortalElement={headingRailPortalElement}
                        scrollContainerRef={controller.scrollContainerRef}
                      />
                    )}
                  />
                )}
              </BlockDocumentSurface>
            ) : (
              <CardStageContent
                controller={controller}
                title={(
                  <textarea
                    value={controller.title}
                    onChange={(event) => controller.handleTitleChange(event.target.value)}
                    onBlur={controller.handleTitleBlur}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") event.preventDefault();
                    }}
                    rows={1}
                    className={cn(
                      "w-full resize-none overflow-hidden",
                      "text-xl/snug-plus font-bold",
                      "text-(--foreground)",
                      "border-none px-0.5 pt-0.75",
                      "bg-transparent focus-visible:ring-0 focus-visible:outline-none",
                      "placeholder:text-(--foreground-disabled)",
                      "field-sizing-content",
                    )}
                    placeholder="Untitled"
                  />
                )}
                description={(
                  <LegacyCardStageDescriptionEditor
                    projectId={props.projectId}
                    projectName={props.projectName}
                    projectWorkspacePath={props.projectWorkspacePath}
                    cardId={card.id}
                    columnId={controller.currentColumnId}
                    content={controller.description}
                    showRawContent={controller.showRawContent}
                    onChange={controller.handleDescriptionChange}
                    onPendingChange={controller.handleDescriptionPendingChange}
                    onBlur={controller.handleDescriptionBlur}
                    flushHandleRef={controller.descriptionFlushHandleRef}
                    sessionId={props.sessionId}
                    sessionThread={props.sessionThread}
                    canStartThreadInSession={props.canStartThreadInSession}
                    linkedCodexThreads={props.linkedCodexThreads}
                    onOpenCodexThread={props.onOpenCodexThread}
                    onOpenCard={props.onOpenCard}
                    onStartNewSessionThreadFromEditor={props.onStartNewSessionThreadFromEditor}
                    onSendThreadSectionPrompt={props.onSendThreadSectionPrompt}
                    isActivePanelTab={props.isActivePanelTab ?? true}
                    headingRailPortalElement={headingRailPortalElement}
                    scrollContainerRef={controller.scrollContainerRef}
                  />
                )}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
