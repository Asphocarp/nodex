import {
  NodexDropdownItem,
  NodexDropdownMenu,
} from "@/components/ui/dropdown";
import {
  closestCenter,
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type Modifier,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { AnimatePresence, motion } from "motion/react";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { ChevronRightIcon, StopIcon } from "@/components/shared/icons";
import {
  NodexDialog,
  NodexDialogAction,
  NodexDialogBody,
  NodexDialogContent,
  NodexDialogDescription,
  NodexDialogFooter,
  NodexDialogForm,
  NodexDialogHeader,
  NodexDialogTitle,
} from "@/components/ui/dialog";
import { NodexTooltip } from "@/components/ui/tooltip";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import type {
  ThreadComposerShellBackgroundAgentRowModel,
  ThreadComposerShellPendingSteerRowModel,
  ThreadComposerShellQueuedFollowUpRowModel,
  ThreadFooterModel,
  ThreadStageActions,
} from "../../thread-stage-types";
import { getThreadGoalMessage } from "../../thread-goal-copy";
import {
  ModelSelectorDropdown,
  ThreadComposer,
} from "./local-conversation-thread-composer";
import { ComposerAdaptiveFooter } from "./composer-adaptive-footer";
import {
  useComposerIntelligenceController,
  type ComposerIntelligenceController,
} from "./use-composer-intelligence-controller";
import {
  shouldShowThreadComposerStatusStrip,
  ThreadComposerStatusStrip,
} from "./local-conversation-thread-composer-status-strip";
import {
  ComposerContextRail,
  ComposerContextRailSlot,
} from "../composer-context-rail";
import { CodexPendingRequestCard } from "./request-cards/codex-pending-request-card";
import { CODEX_THREAD_ACCORDION_TRANSITION } from "../shared/thread-motion";
import {
  LOCAL_CONVERSATION_FIXED_ABOVE_COMPOSER_QUEUE_PORTAL_ATTRIBUTE,
  LOCAL_CONVERSATION_FIXED_ABOVE_COMPOSER_QUEUE_PORTAL_ID,
} from "../local-conversation-above-composer-portal";
import { buildCodexCanonicalRequestIdentityKey } from "../../../../../shared/codex-conversation-state/codex-conversation-state";
import { usePortalHost } from "../use-portal-host";
import { DiffStats } from "../shared/tools/diff-file-shared";
import { ThreadGoalStatusRow } from "./local-conversation-thread-goal-status-row";
import { buildBackgroundAgentOpenContext } from "../../projection/background-subagent-open-context";
import {
  buildBackgroundSubagentCompactStripModel,
  getBackgroundSubagentListRows,
} from "../../projection/background-subagent-summary-model";
import { SubagentAvatar } from "../shared/subagent-avatar";
import {
  useAutoReviewApprovalNudgeActions,
  useAutoReviewApprovalNudgeState,
} from "../../auto-review-approval-nudge-state";
import { AutoReviewApprovalNudge } from "./auto-review-approval-nudge";
import {
  ComposerScope,
  ThreadScope,
  resolveComposerScopeIdentity,
} from "@/lib/workbench-ui-scopes";
import {
  ScopeProvider,
  useScopeHandle,
  useScopedAtom,
} from "@/lib/maitai";
import { activeComposerFocusNonceAtom } from "./composer-draft-state";
import { useContextualKeyboardActionTarget } from "@/lib/use-contextual-keyboard-action-target";
import { markContextualKeyboardActionTargetActive } from "@/lib/contextual-keyboard-actions";

interface LocalConversationComposerShellProps {
  model: ThreadFooterModel;
  actions: ThreadStageActions;
  errorMessage: string | null;
  onErrorMessage: (message: string | null) => void;
  contextRailLeadingContent?: ReactNode;
  hasFixedPortalContent?: boolean;
}

function QueuedMessageReorderGripIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("icon-2xs text-token-input-placeholder-foreground/70", className)} fill="none" aria-hidden="true">
      <circle cx="9.5" cy="5.5" r="1.5" fill="currentColor" />
      <circle cx="9.5" cy="12" r="1.5" fill="currentColor" />
      <circle cx="9.5" cy="18.5" r="1.5" fill="currentColor" />
      <circle cx="14.5" cy="5.5" r="1.5" fill="currentColor" />
      <circle cx="14.5" cy="12" r="1.5" fill="currentColor" />
      <circle cx="14.5" cy="18.5" r="1.5" fill="currentColor" />
    </svg>
  );
}

function QueueLaneHandleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={cn("icon-2xs text-token-input-placeholder-foreground/70", className)} fill="none" aria-hidden="true">
      <path
        d="M2.66797 11V3.33301C2.66797 2.96574 2.96574 2.66797 3.33301 2.66797C3.70028 2.66797 3.99805 2.96574 3.99805 3.33301V11C3.99805 11.7109 3.99894 12.2044 4.03027 12.5879C4.06098 12.9634 4.11776 13.175 4.19824 13.333L4.26856 13.459C4.44487 13.7465 4.69781 13.9808 5 14.1348L5.12988 14.1904C5.27366 14.2419 5.46311 14.2797 5.74512 14.3027C6.12864 14.3341 6.62197 14.335 7.33301 14.335H15L15.0674 14.3418L14.1123 13.3867L14.0273 13.2822C13.8571 13.0242 13.8854 12.6735 14.1123 12.4463C14.3397 12.2189 14.6911 12.1906 14.9492 12.3613L15.0537 12.4463L17.1367 14.5293C17.3964 14.7889 17.3963 15.21 17.1367 15.4697L15.0537 17.5537C14.794 17.8134 14.372 17.8134 14.1123 17.5537C13.8526 17.294 13.8526 16.872 14.1123 16.6123L15.0664 15.6582L15 15.665H7.33301C6.64392 15.665 6.08696 15.6647 5.63672 15.6279C5.23614 15.5952 4.87531 15.5309 4.53906 15.3867L4.39649 15.3193C3.87528 15.0538 3.43887 14.6502 3.13477 14.1543L3.0127 13.9365C2.82084 13.5599 2.74153 13.1541 2.7041 12.6963C2.66732 12.2461 2.66797 11.6889 2.66797 11ZM15.665 15C15.665 15.0226 15.6594 15.0444 15.6572 15.0664L15.7256 14.999L15.6572 14.9316C15.6595 14.9541 15.665 14.9769 15.665 15ZM11.666 8.91797L11.8008 8.93164C12.1036 8.99381 12.3311 9.2618 12.3311 9.58301C12.3311 9.90422 12.1036 10.1722 11.8008 10.2344L11.666 10.248H7.5C7.13273 10.248 6.83496 9.95028 6.83496 9.58301C6.83496 9.21574 7.13273 8.91797 7.5 8.91797H11.666ZM14.166 4.33496L14.3008 4.34863C14.6036 4.41083 14.8311 4.67881 14.8311 5C14.8309 5.32109 14.6035 5.58924 14.3008 5.65137L14.166 5.66504H7.5C7.13284 5.66504 6.83514 5.36712 6.83496 5C6.83496 4.63273 7.13273 4.33496 7.5 4.33496H14.166Z"
        fill="currentColor"
      />
    </svg>
  );
}

function SteerIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 21 21" className={cn("icon-2xs shrink-0", className)} fill="none" aria-hidden="true">
      <path
        d="M13.1293 7.34753C13.3565 7.12027 13.7081 7.09207 13.9662 7.26257L14.0707 7.34753L18.0707 11.3475C18.3304 11.6072 18.3304 12.0292 18.0707 12.2889L14.0707 16.2889C13.811 16.5486 13.389 16.5486 13.1293 16.2889C12.8696 16.0292 12.8696 15.6072 13.1293 15.3475L15.9935 12.4833H6.59998C4.57585 12.4833 2.93494 10.8424 2.93494 8.81824V5.31824C2.93494 4.95097 3.23271 4.6532 3.59998 4.6532C3.96724 4.6532 4.26501 4.95097 4.26501 5.31824V8.81824C4.26501 10.1078 5.31039 11.1532 6.59998 11.1532H15.9935L13.1293 8.28894L13.0443 8.18445C12.8738 7.92632 12.902 7.5748 13.1293 7.34753Z"
        fill="currentColor"
      />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg viewBox="0 0 20 20" className="icon-2xs text-token-input-placeholder-foreground/80" fill="none" aria-hidden="true">
      <path d="M10 14.25V9.5m0-3.75h.0075M17 10a7 7 0 11-14 0 7 7 0 0114 0Z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg viewBox="0 0 20 20" className="icon-2xs" fill="none" aria-hidden="true">
      <path d="M5 10a1.25 1.25 0 112.5 0A1.25 1.25 0 015 10Zm3.75 0a1.25 1.25 0 112.5 0 1.25 1.25 0 01-2.5 0Zm3.75 0a1.25 1.25 0 112.5 0 1.25 1.25 0 01-2.5 0Z" fill="currentColor" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 20 20" className="icon-2xs" fill="none" aria-hidden="true">
      <path d="M6.5 6.5v7m3.5-7v7m3.5-7v7M3.75 5.25h12.5m-9.25 0 .4-1.2A1.25 1.25 0 018.59 3.2h2.82a1.25 1.25 0 011.19.85l.4 1.2m-8.75 0v9A1.75 1.75 0 006 16h8a1.75 1.75 0 001.75-1.75v-9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg viewBox="0 0 20 20" className="icon-2xs" fill="none" aria-hidden="true">
      <path d="M4.75 13.75 4 16l2.25-.75L14.5 7 13 5.5l-8.25 8.25Zm9-9L15.25 3.5a1.06 1.06 0 011.5 0l.75.75a1.06 1.06 0 010 1.5L16 7.25l-2.25-2.5Z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function TerminalIcon() {
  return (
    <svg viewBox="0 0 20 20" className="icon-2xs shrink-0 text-token-input-placeholder-foreground/70" fill="none" aria-hidden="true">
      <path d="M4.5 5.75C4.5 5.05964 5.05964 4.5 5.75 4.5H14.25C14.9404 4.5 15.5 5.05964 15.5 5.75V14.25C15.5 14.9404 14.9404 15.5 14.25 15.5H5.75C5.05964 15.5 4.5 14.9404 4.5 14.25V5.75Z" fill="currentColor" />
    </svg>
  );
}

function QueueActionButton({
  ariaLabel,
  onClick,
  children,
}: {
  ariaLabel: string;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      className="inline-flex size-6 items-center justify-center rounded-md text-token-input-placeholder-foreground transition-colors hover:bg-token-foreground/5 hover:text-token-foreground focus-visible:outline-none"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function ComposerGhostIconButton({
  ariaLabel,
  onClick,
  children,
}: {
  ariaLabel: string;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      className="electron:p-1 electron:[&>svg]:icon-sm inline-flex size-6 items-center justify-center rounded-full p-0.5 text-token-input-placeholder-foreground transition-colors hover:bg-token-foreground/5 hover:text-token-foreground focus-visible:outline-none [&>svg]:icon-2xs"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function QueueSteerActionButton({
  ariaLabel,
  onClick,
  children,
}: {
  ariaLabel: string;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="inline-flex cursor-pointer items-center gap-1 rounded-md bg-token-foreground/5 px-2 py-1 text-size-chat text-token-foreground transition-colors hover:bg-token-foreground/10 focus-visible:outline-none"
      aria-label={ariaLabel}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function ComposerShellCard({
  showRoundedTop,
  children,
}: {
  showRoundedTop: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "bg-token-input-background/70 text-token-foreground border-token-border/80 relative overflow-clip border-x border-t backdrop-blur-sm",
        showRoundedTop && "rounded-t-2xl",
      )}
    >
      {children}
    </div>
  );
}

function clampTransformToRect(
  transform: { x: number; y: number; scaleX: number; scaleY: number },
  rect: {
    top: number;
    left: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
  },
  containerRect: {
    top: number;
    left: number;
    width: number;
    height: number;
  },
) {
  const nextTransform = { ...transform };

  if (rect.top + transform.y <= containerRect.top) {
    nextTransform.y = containerRect.top - rect.top;
  } else if (rect.bottom + transform.y >= containerRect.top + containerRect.height) {
    nextTransform.y = containerRect.top + containerRect.height - rect.bottom;
  }

  if (rect.left + transform.x <= containerRect.left) {
    nextTransform.x = containerRect.left - rect.left;
  } else if (rect.right + transform.x >= containerRect.left + containerRect.width) {
    nextTransform.x = containerRect.left + containerRect.width - rect.right;
  }

  return nextTransform;
}

const restrictHorizontalTransform: Modifier = ({
  transform,
}) => {
  return {
    ...transform,
    x: 0,
  };
};

const restrictToScrollableAncestor: Modifier = ({
  draggingNodeRect,
  transform,
  scrollableAncestorRects,
}) => {
  const scrollRect = scrollableAncestorRects[0];
  if (!draggingNodeRect || !scrollRect) {
    return transform;
  }

  return clampTransformToRect(transform, draggingNodeRect, scrollRect);
};

function PendingSteerTooltipContent() {
  return (
    <div className="max-w-sm space-y-1 text-pretty whitespace-normal">
      <p>This steer will be submitted to the model as soon as possible without interrupting it, usually at the next tool call.</p>
      <p className="text-token-description-foreground">Interrupt the model if you want to give it more immediate input.</p>
    </div>
  );
}

function QueuedFollowUpTooltipContent() {
  return (
    <div className="space-y-1 text-center">
      <p>Submit without interrupting the model</p>
      <p className="text-token-description-foreground">After next model tool call</p>
    </div>
  );
}

function PendingSteerRow({ row }: { row: ThreadComposerShellPendingSteerRowModel }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-2 py-0.5 text-sm">
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        <SteerIcon className="text-token-input-placeholder-foreground/70" />
        <span className="line-clamp-2 min-w-0 flex-1 leading-4 text-token-description-foreground">{row.displayText}</span>
      </span>
      <NodexTooltip tooltipContent={<PendingSteerTooltipContent />}>
        <QueueActionButton ariaLabel="Why this steer is pending">
          <InfoIcon />
        </QueueActionButton>
      </NodexTooltip>
    </div>
  );
}

function QueuedFollowUpRow({
  row,
  actions,
  isQueueingEnabled,
  threadId,
}: {
  row: ThreadComposerShellQueuedFollowUpRowModel;
  actions: ThreadStageActions;
  isQueueingEnabled: boolean;
  threadId: string;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: row.followUpId });

  return (
    <motion.div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: "auto", opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={CODEX_THREAD_ACCORDION_TRANSITION}
      className="overflow-visible"
    >
      <div className={cn("group flex min-w-0 items-center justify-between gap-2 py-0.5 text-sm", (isDragging) && "opacity-60")}>
        <span
          ref={setActivatorNodeRef}
          className="relative flex h-4 cursor-grab items-center justify-center active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          <QueuedMessageReorderGripIcon
            className={cn(
              "icon-2xs text-token-input-placeholder-foreground/70 pointer-events-none absolute right-full top-1/2 -mr-0.5 -translate-y-1/2 transition-opacity",
              isDragging ? "opacity-100" : "opacity-0 group-hover:opacity-100",
            )}
          />
          <QueueLaneHandleIcon />
        </span>
        <span className="line-clamp-2 min-w-0 flex-1 leading-4 text-token-description-foreground">{row.displayText}</span>
        <div className="flex shrink-0 items-center gap-1">
          <NodexTooltip side="top" tooltipContent={<QueuedFollowUpTooltipContent />} tooltipBodyClassName="max-w-80 text-center whitespace-normal leading-snug">
            <QueueSteerActionButton
              ariaLabel="Steer"
              onClick={() => {
                void actions.onSendQueuedFollowUpNow(threadId, row.followUpId);
              }}
            >
              <SteerIcon />
              <span>Steer</span>
            </QueueSteerActionButton>
          </NodexTooltip>
          <QueueActionButton
            ariaLabel="Delete queued message"
            onClick={() => {
              void actions.onRemoveQueuedFollowUp(threadId, row.followUpId);
            }}
          >
            <TrashIcon />
          </QueueActionButton>
          <NodexDropdownMenu
            triggerButton={(
              <QueueActionButton ariaLabel="Queued message actions">
                <MoreIcon />
              </QueueActionButton>
            )}
            side="top"
            align="end"
            contentWidth="xs"
          >
            <NodexDropdownItem
              onSelect={() => {
                void actions.onEditQueuedFollowUp({
                  threadId,
                  followUpId: row.followUpId,
                  prompt: row.prompt,
                  promptInput: row.promptInput,
                });
              }}
              leftSlot={<EditIcon />}
            >
              Edit message
            </NodexDropdownItem>
            <NodexDropdownItem
              disabled={!isQueueingEnabled}
              onSelect={() => {
                actions.onQueueingEnabledChange(false);
              }}
              leftSlot={<QueueLaneHandleIcon className="icon-2xs" />}
            >
              Turn off queueing
            </NodexDropdownItem>
          </NodexDropdownMenu>
        </div>
      </div>
    </motion.div>
  );
}

function QueuePanel({
  model,
  actions,
  showRoundedTop,
}: {
  model: ThreadFooterModel;
  actions: ThreadStageActions;
  showRoundedTop: boolean;
}) {
  const threadId = model.threadId;
  const pendingSteerRows = model.composerShell.pendingSteerRows;
  const queuedFollowUpRows = model.composerShell.queuedFollowUpRows;
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 6,
      },
    }),
  );

  if (!threadId || (pendingSteerRows.length === 0 && queuedFollowUpRows.length === 0)) {
    return null;
  }

  const queuedFollowUpIds = queuedFollowUpRows.map((entry) => entry.followUpId);

  const handleDragEnd = (event: DragEndEvent) => {
    const overId = event.over?.id;
    if (!overId) {
      return;
    }

    const activeId = String(event.active.id);
    const nextOverId = String(overId);
    if (activeId === nextOverId) {
      return;
    }

    const previousIndex = queuedFollowUpIds.indexOf(activeId);
    const nextIndex = queuedFollowUpIds.indexOf(nextOverId);
    if (previousIndex < 0 || nextIndex < 0) {
      return;
    }

    void actions.onReorderQueuedFollowUps(
      threadId,
      arrayMove(queuedFollowUpIds, previousIndex, nextIndex),
    );
  };

  return (
    <ComposerShellCard showRoundedTop={showRoundedTop}>
      <div className="vertical-scroll-fade-mask flex max-h-[30dvh] flex-col gap-px overflow-y-auto px-5 py-row-y">
        {pendingSteerRows.map((row) => (
          <PendingSteerRow key={row.steerId} row={row} />
        ))}
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictHorizontalTransform, restrictToScrollableAncestor]}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={queuedFollowUpIds} strategy={verticalListSortingStrategy}>
            <AnimatePresence initial={false}>
              {queuedFollowUpRows.map((row) => (
                <QueuedFollowUpRow
                  key={row.followUpId}
                  row={row}
                  actions={actions}
                  isQueueingEnabled={model.isQueueingEnabled}
                  threadId={threadId}
                />
              ))}
            </AnimatePresence>
          </SortableContext>
        </DndContext>
      </div>
    </ComposerShellCard>
  );
}

function BackgroundTerminalRow({
  terminal,
}: {
  terminal: ThreadFooterModel["composerShell"]["backgroundTerminalRows"][number];
}) {
  const visibleRow = (
    <div className="min-w-0">
      <div className="truncate font-mono text-sm">
        <span>{terminal.command}</span>
        {terminal.previewLine ? (
          <span className="ml-1 text-token-description-foreground">{terminal.previewLine}</span>
        ) : null}
      </div>
    </div>
  );

  if (terminal.command.length === 0 && terminal.previewLine == null) {
    return visibleRow;
  }

  return (
    <NodexTooltip
      tooltipContent={(
        <div className="max-h-40 max-w-[36rem] overflow-auto font-mono text-sm leading-5">
          <div className="break-all whitespace-pre-wrap">{terminal.command}</div>
          {terminal.previewLine ? (
            <div className="mt-1 break-all whitespace-pre-wrap text-token-description-foreground">
              {terminal.previewLine}
            </div>
          ) : null}
        </div>
      )}
      side="top"
      hoverable
      tooltipBodyClassName="max-w-none"
    >
      {visibleRow}
    </NodexTooltip>
  );
}

function BackgroundTerminalPanel({
  threadId,
  rows,
  actions,
  showRoundedTop,
}: {
  threadId: string;
  rows: ThreadFooterModel["composerShell"]["backgroundTerminalRows"];
  actions: ThreadStageActions;
  showRoundedTop: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  if (rows.length === 0) {
    return null;
  }

  return (
    <ComposerShellCard showRoundedTop={showRoundedTop}>
      <div className="flex items-center justify-between gap-2 px-3 py-row-y">
        <div className="flex min-w-0 items-center gap-2">
          <TerminalIcon />
          <span className="text-size-chat min-w-0 truncate leading-4 text-token-description-foreground">
            Running {rows.length === 1 ? "1 terminal" : `${rows.length} terminals`}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <NodexTooltip tooltipContent="Stop background terminals">
            <ComposerGhostIconButton
              ariaLabel="Stop"
              onClick={() => {
                void actions.onCleanBackgroundTerminals(threadId);
              }}
            >
              <StopIcon className="icon-2xs" />
            </ComposerGhostIconButton>
          </NodexTooltip>
          <ComposerGhostIconButton
            ariaLabel={expanded ? "Collapse running terminals details" : "Expand running terminals details"}
            onClick={() => {
              setExpanded((current) => !current);
            }}
          >
            <ChevronRightIcon className={cn("icon-2xs text-current transition-transform duration-300", expanded && "rotate-90")} />
          </ComposerGhostIconButton>
        </div>
      </div>
      <motion.div
        initial={false}
        animate={{
          height: expanded ? "auto" : 0,
          opacity: expanded ? 1 : 0,
        }}
        transition={CODEX_THREAD_ACCORDION_TRANSITION}
        className={expanded ? "overflow-visible" : "overflow-hidden"}
        style={{
          pointerEvents: expanded ? "auto" : "none",
        }}
      >
        <div className="flex flex-col gap-2 px-3 pt-0.5 pb-3">
          {rows.map((row) => (
            <BackgroundTerminalRow key={row.id} terminal={row} />
          ))}
        </div>
      </motion.div>
    </ComposerShellCard>
  );
}

function resolveBackgroundRowStatusText(status: ThreadComposerShellBackgroundAgentRowModel["status"]) {
  if (status === "active") {
    return "is working";
  }
  if (status === "waiting") {
    return "is awaiting instruction";
  }
  return "is done";
}

function BackgroundAgentRowTooltipContent({ row }: { row: ThreadComposerShellBackgroundAgentRowModel }) {
  if (!row.agentRole && !row.spawnModel) return null;

  return (
    <span className="flex flex-col gap-0.5">
      {row.agentRole ? <span>{row.agentRole}</span> : null}
      {row.spawnModel ? <span>Uses {row.spawnModel}</span> : null}
    </span>
  );
}

function BackgroundAgentRow({
  row,
  actions,
}: {
  row: ThreadComposerShellBackgroundAgentRowModel;
  actions: ThreadStageActions;
}) {
  const active = row.status === "active";
  const metadataTooltip = <BackgroundAgentRowTooltipContent row={row} />;
  const statusText = resolveBackgroundRowStatusText(row.status);

  return (
    <div className="px-0 py-1">
      <div className="text-size-chat block min-w-0 truncate leading-4 text-token-description-foreground">
        <div className="group flex items-center justify-between gap-2">
          <NodexTooltip
            disabled={!row.agentRole && !row.spawnModel}
            side="top"
            tooltipContent={metadataTooltip}
            tooltipBodyClassName="items-start"
          >
            <button
              type="button"
              className="flex max-w-full min-w-0 cursor-interaction items-center gap-1 bg-transparent p-0"
              onClick={() => {
                void actions.onOpenThread(row.conversationId, buildBackgroundAgentOpenContext(row));
              }}
            >
              <span className="flex min-w-0 items-center gap-1.5 text-token-foreground">
                <SubagentAvatar
                  seed={row.conversationId}
                  active={active}
                  className="icon-2xs pointer-events-none"
                />
                <span className="min-w-0 truncate font-medium">{row.displayName}</span>
              </span>
              <span className={cn(
                "shrink-0 whitespace-nowrap text-token-description-foreground",
                active && "loading-shimmer-pure-text",
              )}>
                {statusText}
              </span>
            </button>
          </NodexTooltip>
          {row.diffStats ? (
            <DiffStats
              additions={row.diffStats.linesAdded}
              deletions={row.diffStats.linesRemoved}
              className="mr-0.5 shrink-0 text-size-chat"
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function BackgroundAgentPanel({
  rows,
  actions,
  showRoundedTop,
}: {
  rows: ThreadFooterModel["composerShell"]["backgroundAgentRows"];
  actions: ThreadStageActions;
  showRoundedTop: boolean;
}) {
  const compactModel = buildBackgroundSubagentCompactStripModel(rows);
  const legacyRows = getBackgroundSubagentListRows(rows);
  const stoppableThreadIds = rows
    .filter((row) => row.status !== "done")
    .map((row) => row.conversationId);
  const canStopAll = stoppableThreadIds.length > 0 && Boolean(actions.onStopBackgroundAgents);
  if (rows.length === 0) return null;

  const aggregateContent = compactModel.displayRows.length > 0 ? (
    <>
      <span className="flex shrink-0 items-center gap-1.5">
        {compactModel.displayRows.map((row) => (
          <SubagentAvatar
            key={row.conversationId}
            seed={row.conversationId}
            active={row.status === "active"}
            className="size-4"
          />
        ))}
      </span>
      <span className="text-size-chat min-w-0 truncate leading-4 text-token-foreground">
        {compactModel.workingCount > 0
          ? `${compactModel.workingCount} working`
          : `${compactModel.doneCount} done`}
      </span>
      {compactModel.workingCount > 0 && compactModel.doneCount > 0 ? (
        <span className="text-size-chat shrink-0 text-token-text-tertiary">
          {compactModel.doneCount} done
        </span>
      ) : null}
    </>
  ) : null;

  return (
    <ComposerShellCard showRoundedTop={showRoundedTop}>
      {aggregateContent ? (
        <div className="group flex min-h-8 items-center gap-2 px-3 py-row-y">
          {actions.onOpenSubagentsPanel ? (
            <button
              type="button"
              aria-label="Open subagents"
              className="flex min-w-0 flex-1 cursor-interaction items-center gap-2 rounded-md text-left focus-visible:outline-2 focus-visible:outline-offset-2"
              onClick={() => void actions.onOpenSubagentsPanel?.()}
            >
              {aggregateContent}
            </button>
          ) : (
            <div className="flex min-w-0 flex-1 items-center gap-2">{aggregateContent}</div>
          )}
          {canStopAll ? (
            <NodexTooltip tooltipContent="Stop all subagents in this chat">
              <ComposerGhostIconButton
                ariaLabel="Stop all"
                onClick={() => void actions.onStopBackgroundAgents?.(stoppableThreadIds)}
              >
                <StopIcon className="icon-2xs" />
              </ComposerGhostIconButton>
            </NodexTooltip>
          ) : null}
        </div>
      ) : null}
      {legacyRows.length > 0 ? (
        <div className="flex flex-col gap-0.5 px-3 pb-2">
          {legacyRows.map((row) => (
            <BackgroundAgentRow
              key={row.conversationId}
              row={row}
              actions={actions}
            />
          ))}
        </div>
      ) : null}
    </ComposerShellCard>
  );
}

function RequestCardStack({
  model,
  actions,
  intelligenceController,
  onManualApproval,
}: {
  model: ThreadFooterModel;
  actions: ThreadStageActions;
  intelligenceController: ComposerIntelligenceController;
  onManualApproval: (conversationId: string) => Promise<void>;
}) {
  const entries = [
    model.composerShell.backgroundRequest,
    model.composerShell.activeRequest,
  ].filter((entry) => entry !== null);

  return (
    <div className="relative flex flex-col gap-2">
      {entries.map((entry) => {
        if (!entry) {
          return null;
        }
        return (
          <div
            key={`${entry.surface}:${buildCodexCanonicalRequestIdentityKey(entry.request.requestId)}`}
            className="flex flex-col"
          >
            <CodexPendingRequestCard
              entry={entry}
              actions={actions}
              intelligenceController={intelligenceController}
              onManualApproval={onManualApproval}
            />
          </div>
        );
      })}
      {model.composerShell.activeRequest?.request.type === "implementPlan" ? (
        <div data-implement-plan-intelligence-footer="true">
          <ComposerAdaptiveFooter
            input={null}
            layout="multiline"
            leadingControls={(
              <ModelSelectorDropdown
                model={model}
                controller={intelligenceController}
                actions={actions}
              />
            )}
            trailingControls={null}
          />
        </div>
      ) : null}
    </div>
  );
}

export type ComposerReplacementOwner = "normal" | "autoReviewNudge" | "requestStack";

export function resolveComposerReplacementOwner(input: {
  threadId: string | null;
  hasAutoReviewNudge: boolean;
  isResponseInProgress: boolean;
  hasRequestCards: boolean;
}): ComposerReplacementOwner {
  if (!input.threadId) return "normal";
  if (input.hasAutoReviewNudge && !input.isResponseInProgress) return "autoReviewNudge";
  if (input.hasRequestCards) return "requestStack";
  return "normal";
}

function ThreadGoalResumeConfirmationDialog({
  model,
  actions,
}: {
  model: ThreadFooterModel;
  actions: ThreadStageActions;
}) {
  const goal = model.conversation?.threadGoalResumeConfirmation ?? null;
  const threadId = model.threadId;
  const [pendingAction, setPendingAction] = useState<"dismiss" | "resume" | null>(null);

  if (!threadId || !goal) {
    return null;
  }

  const isPaused = goal.status === "paused";
  const title = isPaused
    ? getThreadGoalMessage("composer.threadGoal.resumeConfirmation.title")
    : getThreadGoalMessage("composer.threadGoal.resumeConfirmation.resumableTitle");
  const dismissLabel = isPaused
    ? getThreadGoalMessage("composer.threadGoal.resumeConfirmation.keepPaused")
    : getThreadGoalMessage("composer.threadGoal.resumeConfirmation.notNow");
  const isBusy = pendingAction !== null;

  const handleDismiss = async () => {
    if (!actions.onDismissThreadGoalResumeConfirmation) {
      return;
    }

    setPendingAction("dismiss");
    try {
      await actions.onDismissThreadGoalResumeConfirmation(threadId);
    } catch {
      toast.danger(getThreadGoalMessage("composer.threadGoal.resumeConfirmation.dismissError"));
    } finally {
      setPendingAction(null);
    }
  };

  const handleResume = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!actions.onSetThreadGoal) {
      return;
    }

    setPendingAction("resume");
    try {
      await actions.onSetThreadGoal({
        threadId,
        status: "active",
      });
    } catch {
      toast.danger(getThreadGoalMessage("composer.threadGoal.statusUpdateError"));
    } finally {
      setPendingAction(null);
    }
  };

  return (
    <NodexDialog
      open
      onOpenChange={(open) => {
        if (!open) {
          void handleDismiss();
        }
      }}
    >
      <NodexDialogContent showCloseButton={false}>
        <NodexDialogForm onSubmit={handleResume}>
          <NodexDialogHeader>
            <NodexDialogTitle>{title}</NodexDialogTitle>
            <NodexDialogDescription>
              {getThreadGoalMessage("composer.threadGoal.resumeConfirmation.subtitle")}
            </NodexDialogDescription>
          </NodexDialogHeader>
          <NodexDialogBody>
            <div className="line-clamp-4 rounded-lg bg-token-bg-secondary px-3 py-2 text-sm text-token-foreground">
              {goal.objective}
            </div>
          </NodexDialogBody>
          <NodexDialogFooter>
            <NodexDialogAction
              disabled={isBusy || !actions.onDismissThreadGoalResumeConfirmation}
              onClick={() => {
                void handleDismiss();
              }}
            >
              {dismissLabel}
            </NodexDialogAction>
            <NodexDialogAction
              type="submit"
              tone="primary"
              disabled={isBusy || !actions.onSetThreadGoal}
            >
              {getThreadGoalMessage("composer.threadGoal.resumeConfirmation.resume")}
            </NodexDialogAction>
          </NodexDialogFooter>
        </NodexDialogForm>
      </NodexDialogContent>
    </NodexDialog>
  );
}

export function LocalConversationComposerShell(props: LocalConversationComposerShellProps) {
  const requestedFocusNonce = props.model.composerIntent?.focusNonce
    ?? props.model.newThreadComposerIntent?.focusNonce
    ?? null;
  const [activeFocusNonce, setActiveFocusNonce] = useScopedAtom(activeComposerFocusNonceAtom);
  const threadHandle = useScopeHandle(ThreadScope);
  useLayoutEffect(() => {
    if (requestedFocusNonce === null || requestedFocusNonce === activeFocusNonce) return;
    setActiveFocusNonce(requestedFocusNonce);
  }, [activeFocusNonce, requestedFocusNonce, setActiveFocusNonce]);
  const focusComposerNonce = requestedFocusNonce ?? activeFocusNonce;
  const descriptor = resolveComposerScopeIdentity({
    kind: props.model.isNewThreadTab ? "new-conversation" : "task",
    stableIdentity: props.model.composerScopeIdentity?.trim() || threadHandle.path,
    focusComposerNonce,
  });

  return (
    <ScopeProvider scope={ComposerScope} descriptor={descriptor}>
      <ScopedLocalConversationComposerShell {...props} />
    </ScopeProvider>
  );
}

function ScopedLocalConversationComposerShell({
  model,
  actions,
  errorMessage,
  onErrorMessage,
  contextRailLeadingContent,
  hasFixedPortalContent = false,
}: LocalConversationComposerShellProps) {
  const intelligenceController = useComposerIntelligenceController(model, actions);
  const permissionState = model.permissionState;
  const autoReviewNudgeState = useAutoReviewApprovalNudgeState();
  const {
    recordManualApproval: recordManualApprovalForNudge,
    resolveNudge,
  } = useAutoReviewApprovalNudgeActions();
  const autoReviewNudgeEligible = permissionState?.mode === "auto"
    && permissionState.autoReviewAvailable
    && permissionState.availableModes.includes("guardian-approvals");
  const hasAutoReviewNudge = Boolean(
    model.threadId
    && autoReviewNudgeEligible
    && autoReviewNudgeState.activeThreadIds[model.threadId] === true,
  );
  const replacementOwner = resolveComposerReplacementOwner({
    threadId: model.threadId,
    hasAutoReviewNudge,
    isResponseInProgress: model.isThreadRunning,
    hasRequestCards: model.composerShell.showRequestCards,
  });
  const selectorAvailable = model.agentProviderCatalog && model.executionProfile
    ? true
    : model.availableModels.some((candidate) => !candidate.hidden);
  const selectorOwnedBySurface = replacementOwner === "normal"
    || (
      replacementOwner === "requestStack"
      && model.composerShell.activeRequest?.request.type === "implementPlan"
    );
  const selectorSurfaceId = `composer-model-picker:${model.composerScopeIdentity?.trim() || model.threadId || "new-thread"}`;
  const selectorPresentationId = model.composerScopeIdentity?.trim()
    || model.threadId
    || selectorSurfaceId;
  const contextualSelectorTarget = useMemo(() => ({
    surfaceId: selectorSurfaceId,
    presentationId: selectorPresentationId,
    canExecute: (commandId: import("../../../../../shared/command-keybindings").CommandId) => (
      commandId === "openModelPicker"
      && selectorAvailable
      && selectorOwnedBySurface
    ),
    execute: (commandId: import("../../../../../shared/command-keybindings").CommandId) => {
      if (commandId !== "openModelPicker" || !selectorAvailable || !selectorOwnedBySurface) {
        return false;
      }
      intelligenceController.open();
      return true;
    },
  }), [
    intelligenceController,
    selectorAvailable,
    selectorOwnedBySurface,
    selectorPresentationId,
    selectorSurfaceId,
  ]);
  useContextualKeyboardActionTarget(contextualSelectorTarget);
  useEffect(() => {
    if (!model.threadId || permissionState?.mode === "auto") return;
    resolveNudge(model.threadId);
  }, [model.threadId, permissionState?.mode, resolveNudge]);
  const recordManualApproval = async (conversationId: string) => {
    await recordManualApprovalForNudge({
      threadId: conversationId,
      eligible: autoReviewNudgeEligible,
    });
  };
  const queuePortalHost = usePortalHost({
    attribute: LOCAL_CONVERSATION_FIXED_ABOVE_COMPOSER_QUEUE_PORTAL_ATTRIBUTE,
    fallbackId: LOCAL_CONVERSATION_FIXED_ABOVE_COMPOSER_QUEUE_PORTAL_ID,
    conversationId: model.threadId,
  });
  const showQueuePanel = model.composerShell.pendingSteerRows.length > 0 || model.composerShell.queuedFollowUpRows.length > 0;
  const threadGoal = model.conversation?.threadGoal ?? null;
  const showThreadGoalStatusRow = threadGoal !== null && threadGoal.status !== "complete";
  const backgroundTerminalThreadId = model.threadId;
  const showBackgroundTerminals =
    backgroundTerminalThreadId !== null && model.composerShell.backgroundTerminalRows.length > 0;
  const showBackgroundAgents = model.composerShell.backgroundAgentRows.length > 0;
  const showAuxiliaryLaneStack = showQueuePanel || showThreadGoalStatusRow || showBackgroundTerminals || showBackgroundAgents;
  let sectionIndex = hasFixedPortalContent ? 1 : 0;

  const resolveRoundedTop = () => {
    const showRoundedTop = sectionIndex === 0;
    sectionIndex += 1;
    return showRoundedTop;
  };

  const auxiliaryLaneStack = showAuxiliaryLaneStack ? (
    <div className="order-2 flex flex-col">
      {showQueuePanel ? (
        <QueuePanel
          model={model}
          actions={actions}
          showRoundedTop={resolveRoundedTop()}
        />
      ) : null}
      {showThreadGoalStatusRow ? (
        <ThreadGoalStatusRow
          goal={threadGoal}
          actions={actions}
          showRoundedTop={resolveRoundedTop()}
        />
      ) : null}
      {showBackgroundTerminals ? (
        <BackgroundTerminalPanel
          threadId={backgroundTerminalThreadId}
          rows={model.composerShell.backgroundTerminalRows}
          actions={actions}
          showRoundedTop={resolveRoundedTop()}
        />
      ) : null}
      {showBackgroundAgents ? (
        <BackgroundAgentPanel
          rows={model.composerShell.backgroundAgentRows}
          actions={actions}
          showRoundedTop={resolveRoundedTop()}
        />
      ) : null}
    </div>
  ) : null;
  const showStatusStrip = shouldShowThreadComposerStatusStrip(model);

  return (
    <div
      data-local-conversation-composer-shell="true"
      className="relative flex w-full flex-col gap-2 pb-0"
      onFocusCapture={() => markContextualKeyboardActionTargetActive(selectorSurfaceId)}
      onPointerDownCapture={() => markContextualKeyboardActionTargetActive(selectorSurfaceId)}
    >
      <ThreadGoalResumeConfirmationDialog model={model} actions={actions} />
      {queuePortalHost && auxiliaryLaneStack ? createPortal(auxiliaryLaneStack, queuePortalHost) : null}
      {!showStatusStrip && contextRailLeadingContent ? (
        <ComposerContextRailSlot visible>
          <ComposerContextRail>
            {contextRailLeadingContent}
            <span aria-hidden="true" className="order-2 min-w-0 flex-1" />
          </ComposerContextRail>
        </ComposerContextRailSlot>
      ) : null}
      {replacementOwner !== "normal" ? (
        <ComposerContextRailSlot visible={showStatusStrip}>
          <ThreadComposerStatusStrip
            model={model}
            actions={actions}
            onErrorMessage={onErrorMessage}
            contextRailLeadingContent={contextRailLeadingContent}
          />
        </ComposerContextRailSlot>
      ) : null}
      {replacementOwner === "autoReviewNudge" && model.threadId ? (
        <AutoReviewApprovalNudge threadId={model.threadId} actions={actions} />
      ) : replacementOwner === "requestStack" ? (
        <>
          <RequestCardStack
            model={model}
            actions={actions}
            intelligenceController={intelligenceController}
            onManualApproval={recordManualApproval}
          />
        </>
      ) : (
        <ThreadComposer
          model={model}
          actions={actions}
          errorMessage={errorMessage}
          onErrorMessage={onErrorMessage}
          contextRailLeadingContent={contextRailLeadingContent}
          intelligenceController={intelligenceController}
        />
      )}
    </div>
  );
}
