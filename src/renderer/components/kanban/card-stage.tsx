import { memo, type CSSProperties, type MutableRefObject } from "react";
import { NfmEditor } from "./editor/nfm-editor";
import { cn } from "@/lib/utils";
import { CardStageInlinePropertyStrip } from "./card-stage/inline-property-strip";
import { CardStagePropertiesSection } from "./card-stage/properties-section";
import { CardStageRawContent } from "./card-stage/raw-content";
import { CardStageToolbar } from "./card-stage/toolbar";
import { useCardStageController } from "./card-stage/use-card-stage-controller";
import type { CardStageDescriptionFlushHandle, CardStageProps } from "./card-stage/types";
import { RIGHT_PANEL_COMPOSER_OVERLAY_SCROLL_RESERVE_STYLE } from "@/lib/right-panel-composer-overlay-reserve";

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
  onBlur: () => void;
  flushHandleRef: MutableRefObject<CardStageDescriptionFlushHandle | null>;
  sessionId?: string | null;
  sessionThread: CardStageProps["sessionThread"];
  canStartThreadInSession: CardStageProps["canStartThreadInSession"];
  linkedCodexThreads: CardStageProps["linkedCodexThreads"];
  onOpenCodexThread: CardStageProps["onOpenCodexThread"];
  onStartNewSessionThreadFromEditor: CardStageProps["onStartNewSessionThreadFromEditor"];
  onSendThreadSectionPrompt: CardStageProps["onSendThreadSectionPrompt"];
  isActivePanelTab: boolean;
}

const CardStageDescriptionEditor = memo(function CardStageDescriptionEditor({
  projectId,
  projectName,
  projectWorkspacePath,
  cardId,
  columnId,
  content,
  showRawContent,
  onChange,
  onBlur,
  flushHandleRef,
  sessionId,
  sessionThread,
  canStartThreadInSession,
  linkedCodexThreads,
  onOpenCodexThread,
  onStartNewSessionThreadFromEditor,
  onSendThreadSectionPrompt,
  isActivePanelTab,
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
      content={content}
      onChange={onChange}
      onBlur={onBlur}
      flushHandleRef={flushHandleRef}
      sourceCardContext={{
        cardId,
        columnId,
      }}
      sessionId={sessionId}
      sessionThread={sessionThread}
      canStartThreadInSession={canStartThreadInSession}
      linkedCodexThreads={linkedCodexThreads}
      onOpenCodexThread={onOpenCodexThread}
      onStartNewSessionThreadFromEditor={onStartNewSessionThreadFromEditor}
      onSendThreadSectionPrompt={onSendThreadSectionPrompt}
      isActivePanelTab={isActivePanelTab}
      placeholder="Add a description..."
    />
  );
});

export function CardStage(props: CardStageProps) {
  const controller = useCardStageController(props);

  if (!controller.card) return null;

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
        ref={controller.scrollContainerRef}
        onScroll={controller.handleScroll}
        className="scrollbar-token min-h-0 flex-1 overflow-y-auto"
        data-testid={CARD_STAGE_SCROLL_CONTAINER_TEST_ID}
        style={CARD_STAGE_SCROLL_CONTAINER_STYLE}
      >
        <div
          className={controller.contentBodyClassName}
          data-card-stage-body="true"
          data-card-stage-body-width={controller.limitMainContentWidth ? "constrained" : "full"}
        >
          <div className={controller.contentShellClassName}>
            <div className="h-toolbar-sm" />

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

            <div className="pt-2 pb-8">
              <CardStageDescriptionEditor
                projectId={props.projectId}
                projectName={props.projectName}
                projectWorkspacePath={props.projectWorkspacePath}
                cardId={controller.card.id}
                columnId={controller.currentColumnId}
                content={controller.description}
                showRawContent={controller.showRawContent}
                onChange={controller.handleDescriptionChange}
                onBlur={controller.handleDescriptionBlur}
                flushHandleRef={controller.descriptionFlushHandleRef}
                sessionId={props.sessionId}
                sessionThread={props.sessionThread}
                canStartThreadInSession={props.canStartThreadInSession}
                linkedCodexThreads={props.linkedCodexThreads}
                onOpenCodexThread={props.onOpenCodexThread}
                onStartNewSessionThreadFromEditor={props.onStartNewSessionThreadFromEditor}
                onSendThreadSectionPrompt={props.onSendThreadSectionPrompt}
                isActivePanelTab={props.isActivePanelTab ?? true}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
