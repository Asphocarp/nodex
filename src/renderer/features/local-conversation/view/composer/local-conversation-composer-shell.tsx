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
import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronRightIcon, StopIcon } from "@/components/shared/icons";
import { NodexTooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type {
  ThreadComposerShellBackgroundAgentRowModel,
  ThreadComposerShellPendingSteerRowModel,
  ThreadComposerShellQueuedFollowUpRowModel,
  ThreadFooterModel,
  ThreadStageActions,
} from "../../thread-stage-types";
import { ThreadComposer } from "./local-conversation-thread-composer";
import { ThreadComposerStatusStrip } from "./local-conversation-thread-composer-status-strip";
import { CodexPendingRequestCard } from "./request-cards/codex-pending-request-card";
import { CODEX_THREAD_ACCORDION_TRANSITION } from "../shared/thread-motion";
import {
  LOCAL_CONVERSATION_FIXED_ABOVE_COMPOSER_QUEUE_PORTAL_ID,
} from "../local-conversation-above-composer-portal";
import { usePortalHost } from "../use-portal-host";

interface LocalConversationComposerShellProps {
  model: ThreadFooterModel;
  actions: ThreadStageActions;
  errorMessage: string | null;
  onErrorMessage: (message: string | null) => void;
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

function AgentIcon() {
  return (
    <svg viewBox="0 0 20 20" className="icon-2xs shrink-0 text-token-input-placeholder-foreground/70" fill="none" aria-hidden="true">
      <path d="M9.99998 2.5a2.25 2.25 0 012.25 2.25v.625a3.625 3.625 0 012.75 3.5v2.625A3.875 3.875 0 0111.125 15.5H8.87498A3.875 3.875 0 014.99998 11.625V8.875a3.625 3.625 0 012.75-3.5V4.75A2.25 2.25 0 019.99998 2.5Zm-2.25 7.125a.875.875 0 100 1.75.875.875 0 000-1.75Zm4.5 0a.875.875 0 100 1.75.875.875 0 000-1.75Z" fill="currentColor" />
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
      interactive
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

function BackgroundAgentPanel({
  rows,
  actions,
  showRoundedTop,
}: {
  rows: ThreadFooterModel["composerShell"]["backgroundAgentRows"];
  actions: ThreadStageActions;
  showRoundedTop: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const summary = expanded
    ? `${rows.length} background ${rows.length === 1 ? "agent" : "agents"} (@ to tag agents)`
    : `${rows.length} background ${rows.length === 1 ? "agent" : "agents"}`;
  if (rows.length === 0) {
    return null;
  }

  return (
    <ComposerShellCard showRoundedTop={showRoundedTop}>
      <div className="group flex items-center justify-between gap-2 px-3 py-row-y">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          aria-expanded={expanded}
          onClick={() => {
            setExpanded((current) => !current);
          }}
        >
          <AgentIcon />
          <span className="text-size-chat min-w-0 truncate leading-4 text-token-description-foreground">
            {summary}
          </span>
        </button>
        <QueueActionButton
          ariaLabel={expanded ? "Collapse background agent details" : "Expand background agent details"}
          onClick={() => {
            setExpanded((current) => !current);
          }}
        >
          <ChevronRightIcon className={cn("text-current transition-transform duration-300", expanded ? "rotate-90" : "-rotate-90")} />
        </QueueActionButton>
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
        <div className="vertical-scroll-fade-mask flex max-h-24 flex-col gap-0.5 overflow-y-auto px-3 pb-2 [--edge-fade-distance:1rem]">
          {rows.map((row) => (
            <div key={row.conversationId} className="px-0 py-1">
              <div className="text-size-chat block min-w-0 truncate leading-4 text-token-description-foreground">
                <div className="group flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate">
                    <button
                      type="button"
                      className="mr-1 inline cursor-pointer bg-transparent p-0 font-medium text-token-foreground"
                      onClick={() => {
                        actions.onOpenThread(row.conversationId);
                      }}
                    >
                      {row.displayName}
                    </button>
                    <span className={cn("text-token-description-foreground", row.status === "active" && "loading-shimmer-pure-text")}>
                      {resolveBackgroundRowStatusText(row.status)}
                    </span>
                  </span>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      className="text-size-chat inline-flex cursor-pointer items-center text-token-description-foreground opacity-70 hover:text-token-foreground hover:opacity-100"
                      onClick={() => {
                        actions.onOpenThread(row.conversationId);
                      }}
                    >
                      Open
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </motion.div>
    </ComposerShellCard>
  );
}

function RequestCardStack({
  model,
  actions,
}: {
  model: ThreadFooterModel;
  actions: ThreadStageActions;
}) {
  const entries = [
    model.composerShell.backgroundRequest,
    model.composerShell.activeRequest,
  ].filter((entry) => entry !== null);

  return (
    <div className="flex flex-col gap-2">
      {entries.map((entry) => {
        if (!entry) {
          return null;
        }
        return (
          <div key={`${entry.surface}:${entry.request.requestId}`} className="flex flex-col">
            <CodexPendingRequestCard entry={entry} actions={actions} />
          </div>
        );
      })}
    </div>
  );
}

export function LocalConversationComposerShell({
  model,
  actions,
  errorMessage,
  onErrorMessage,
}: LocalConversationComposerShellProps) {
  const hasFixedPortalContent = model.body.hasAboveComposerBlocks;
  const queuePortalHost = usePortalHost(LOCAL_CONVERSATION_FIXED_ABOVE_COMPOSER_QUEUE_PORTAL_ID);
  const showQueuePanel = model.composerShell.pendingSteerRows.length > 0 || model.composerShell.queuedFollowUpRows.length > 0;
  const backgroundTerminalThreadId = model.threadId;
  const showBackgroundTerminals =
    backgroundTerminalThreadId !== null && model.composerShell.backgroundTerminalRows.length > 0;
  const showBackgroundAgents = model.composerShell.backgroundAgentRows.length > 0 && !model.composerShell.showApprovalMode;
  const showAuxiliaryLaneStack = showQueuePanel || showBackgroundTerminals || showBackgroundAgents;
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

  return (
    <div
      data-local-conversation-composer-shell="true"
      className="relative flex w-full flex-col gap-2 pb-0"
    >
      {queuePortalHost && auxiliaryLaneStack ? createPortal(auxiliaryLaneStack, queuePortalHost) : null}
      {model.composerShell.showRequestCards ? (
        <>
          <RequestCardStack model={model} actions={actions} />
          <ThreadComposerStatusStrip model={model} onErrorMessage={onErrorMessage} />
        </>
      ) : (
        <ThreadComposer
          model={model}
          actions={actions}
          errorMessage={errorMessage}
          onErrorMessage={onErrorMessage}
        />
      )}
    </div>
  );
}
