import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { motion } from "motion/react";
import { useState, type ReactNode } from "react";
import { StopIcon } from "@/components/shared/icons";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type {
  ThreadComposerShellBackgroundAgentRowModel,
  ThreadStageActions,
  ThreadStageModel,
} from "../../thread-stage-types";
import {
  SELECTOR_MENU_CONTENT_CLASS_NAME,
  SELECTOR_MENU_ITEM_CLASS_NAME,
  SELECTOR_MENU_LIST_CLASS_NAME,
  SELECTOR_MENU_PANEL_CLASS_NAME,
} from "../shared/selector-popover-primitives";
import { ThreadComposer } from "./local-conversation-thread-composer";
import { CodexPendingRequestCard } from "./request-cards/codex-pending-request-card";
import { CODEX_MEASURED_TRANSITION } from "../shared/use-measured-element-height";

interface LocalConversationComposerShellProps {
  model: ThreadStageModel;
  actions: ThreadStageActions;
  errorMessage: string | null;
  onErrorMessage: (message: string | null) => void;
}

function DragHandleIcon() {
  return (
    <svg viewBox="0 0 20 20" className="icon-2xs text-token-input-placeholder-foreground/70" fill="none" aria-hidden="true">
      <path d="M7 5.5a1 1 0 110-2 1 1 0 010 2Zm0 4a1 1 0 110-2 1 1 0 010 2Zm0 4a1 1 0 110-2 1 1 0 010 2Zm6-8a1 1 0 110-2 1 1 0 010 2Zm0 4a1 1 0 110-2 1 1 0 010 2Zm0 4a1 1 0 110-2 1 1 0 010 2Z" fill="currentColor" />
    </svg>
  );
}

function SteerIcon() {
  return (
    <svg viewBox="0 0 21 21" className="icon-2xs shrink-0" fill="none" aria-hidden="true">
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

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      className={cn("icon-2xs text-current transition-transform duration-300", expanded ? "rotate-90" : "-rotate-90")}
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M7.52925 3.7793C7.75652 3.55203 8.10803 3.52383 8.36616 3.69434L8.47065 3.7793L14.2207 9.5293C14.4804 9.789 14.4804 10.211 14.2207 10.4707L8.47065 16.2207C8.21095 16.4804 7.78895 16.4804 7.52925 16.2207C7.26955 15.961 7.26955 15.539 7.52925 15.2793L12.8085 10L7.52925 4.7207L7.44429 4.61621C7.27378 4.35808 7.30198 4.00657 7.52925 3.7793Z"
        fill="currentColor"
      />
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
      className="inline-flex size-6 items-center justify-center rounded-full text-token-input-placeholder-foreground transition-colors hover:bg-transparent hover:text-token-foreground focus-visible:outline-none"
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

function QueuePanel({
  model,
  actions,
  showRoundedTop,
}: {
  model: ThreadStageModel;
  actions: ThreadStageActions;
  showRoundedTop: boolean;
}) {
  const [draggingFollowUpId, setDraggingFollowUpId] = useState<string | null>(null);
  const threadId = model.conversation?.threadId ?? null;
  const pendingSteers = model.composerShell.pendingSteers;
  const queuedFollowUps = model.composerShell.queuedFollowUps;

  if (!threadId || (pendingSteers.length === 0 && queuedFollowUps.length === 0)) {
    return null;
  }

  const handleDropFollowUp = async (targetFollowUpId: string) => {
    if (!draggingFollowUpId || draggingFollowUpId === targetFollowUpId) {
      return;
    }

    const orderedFollowUpIds = queuedFollowUps.map((entry) => entry.followUpId);
    const fromIndex = orderedFollowUpIds.indexOf(draggingFollowUpId);
    const toIndex = orderedFollowUpIds.indexOf(targetFollowUpId);
    if (fromIndex < 0 || toIndex < 0) {
      return;
    }

    const nextOrdered = [...orderedFollowUpIds];
    const [moved] = nextOrdered.splice(fromIndex, 1);
    if (!moved) {
      return;
    }

    nextOrdered.splice(toIndex, 0, moved);
    await actions.onReorderQueuedFollowUps(threadId, nextOrdered);
  };

  return (
    <ComposerShellCard showRoundedTop={showRoundedTop}>
      <div className="vertical-scroll-fade-mask flex max-h-[30dvh] flex-col gap-px overflow-y-auto px-5 py-row-y">
        {pendingSteers.map((entry) => (
          <div key={entry.steerId} className="flex min-w-0 items-center justify-between gap-2 py-0.5 text-sm">
            <span className="flex min-w-0 flex-1 items-center gap-1.5">
              <SteerIcon />
              <span className="line-clamp-2 min-w-0 flex-1 leading-4 text-token-description-foreground">{entry.prompt}</span>
            </span>
            <Tooltip
              content={
                <div className="max-w-sm space-y-1 text-pretty whitespace-normal">
                  <p>This steer will be submitted to the model as soon as possible without interrupting it.</p>
                  <p className="text-token-description-foreground">Interrupt the model if you want to give it more immediate input.</p>
                </div>
              }
            >
              <QueueActionButton ariaLabel="Why this steer is pending">
                <InfoIcon />
              </QueueActionButton>
            </Tooltip>
          </div>
        ))}

        {queuedFollowUps.map((entry) => {
          const followUpId = entry.followUpId;
          return (
            <div
              key={followUpId}
              draggable
              onDragStart={() => {
                setDraggingFollowUpId(followUpId);
              }}
              onDragEnd={() => {
                setDraggingFollowUpId(null);
              }}
              onDragOver={(event) => {
                event.preventDefault();
              }}
              onDrop={(event) => {
                event.preventDefault();
                void handleDropFollowUp(followUpId);
                setDraggingFollowUpId(null);
              }}
              className={cn(
                "group flex min-w-0 items-center justify-between gap-2 py-0.5 text-sm",
                draggingFollowUpId === followUpId && "opacity-60",
              )}
            >
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <span className="relative flex h-4 cursor-grab items-center justify-center active:cursor-grabbing">
                  <DragHandleIcon />
                </span>
                <span className="line-clamp-2 min-w-0 flex-1 leading-4 text-token-description-foreground">
                  {entry.prompt}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Tooltip
                  side="top"
                  content={
                    <div className="space-y-1 text-center">
                      <p>Submit without interrupting the model</p>
                      <p className="text-token-description-foreground">After next model tool call</p>
                    </div>
                  }
                >
                  <button
                    type="button"
                    className="inline-flex cursor-pointer items-center gap-1 rounded-full bg-token-foreground/5 px-2 py-1 text-size-chat text-token-input-foreground transition-colors hover:bg-token-foreground/10 focus-visible:outline-none"
                    aria-label="Steer"
                    onClick={() => {
                      void actions.onSendQueuedFollowUpNow(threadId, followUpId);
                    }}
                  >
                    <SteerIcon />
                    <span>Steer</span>
                  </button>
                </Tooltip>
                <QueueActionButton
                  ariaLabel="Delete queued message"
                  onClick={() => {
                    void actions.onRemoveQueuedFollowUp(threadId, followUpId);
                  }}
                >
                  <TrashIcon />
                </QueueActionButton>
                <DropdownMenuPrimitive.Root>
                  <DropdownMenuPrimitive.Trigger asChild>
                    <QueueActionButton ariaLabel="Queued message actions">
                      <MoreIcon />
                    </QueueActionButton>
                  </DropdownMenuPrimitive.Trigger>
                  <DropdownMenuPrimitive.Portal>
                    <DropdownMenuPrimitive.Content
                      side="top"
                      align="end"
                      sideOffset={6}
                      collisionPadding={8}
                      className={cn(SELECTOR_MENU_CONTENT_CLASS_NAME, "outline-none")}
                    >
                      <div className={cn(SELECTOR_MENU_PANEL_CLASS_NAME, "min-w-44")}>
                        <div className={SELECTOR_MENU_LIST_CLASS_NAME}>
                          <DropdownMenuPrimitive.Item
                            className={SELECTOR_MENU_ITEM_CLASS_NAME}
                            onSelect={() => {
                              void actions.onEditQueuedFollowUp({
                                threadId,
                                followUpId,
                                prompt: entry.prompt,
                              });
                            }}
                          >
                            <div className="flex w-full items-center gap-1.5 text-token-description-foreground">
                              <EditIcon />
                              <span>Edit message</span>
                            </div>
                          </DropdownMenuPrimitive.Item>
                          <DropdownMenuPrimitive.Item
                            className={cn(
                              SELECTOR_MENU_ITEM_CLASS_NAME,
                              !model.isQueueingEnabled && "pointer-events-none opacity-50",
                            )}
                            onSelect={() => {
                              if (!model.isQueueingEnabled) {
                                return;
                              }
                              actions.onQueueingEnabledChange(false);
                            }}
                          >
                            <div className="flex w-full items-center gap-1.5 text-token-description-foreground">
                              <DragHandleIcon />
                              <span>Turn off queueing</span>
                            </div>
                          </DropdownMenuPrimitive.Item>
                        </div>
                      </div>
                    </DropdownMenuPrimitive.Content>
                  </DropdownMenuPrimitive.Portal>
                </DropdownMenuPrimitive.Root>
              </div>
            </div>
          );
        })}
      </div>
    </ComposerShellCard>
  );
}

function BackgroundTerminalPanel({
  rows,
  actions,
  showRoundedTop,
}: {
  rows: ThreadStageModel["composerShell"]["backgroundTerminalRows"];
  actions: ThreadStageActions;
  showRoundedTop: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  if (rows.length === 0) {
    return null;
  }

  const uniqueThreadIds = [...new Set(rows.map((row) => row.threadId))];

  return (
    <ComposerShellCard showRoundedTop={showRoundedTop}>
      <div className="group flex items-center justify-between gap-2 px-3 py-row-y">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <TerminalIcon />
          <span className="text-size-chat min-w-0 truncate leading-4 text-token-description-foreground">
            Running {rows.length === 1 ? "1 terminal" : `${rows.length} terminals`}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Tooltip content="Stop background terminals">
            <button
              type="button"
              className="inline-flex size-6 items-center justify-center rounded-full text-token-input-placeholder-foreground transition-colors hover:bg-transparent hover:text-token-foreground focus-visible:outline-none"
              aria-label="Stop"
              onClick={() => {
                void actions.onStopBackgroundTerminals(uniqueThreadIds);
              }}
            >
              <StopIcon className="icon-2xs" />
            </button>
          </Tooltip>
          <QueueActionButton
            ariaLabel={expanded ? "Collapse background terminals" : "Expand background terminals"}
            onClick={() => {
              setExpanded((current) => !current);
            }}
          >
            <ChevronIcon expanded={expanded} />
          </QueueActionButton>
        </div>
      </div>
      <motion.div
        initial={false}
        animate={{
          height: expanded ? "auto" : 0,
          opacity: expanded ? 1 : 0,
        }}
        transition={CODEX_MEASURED_TRANSITION}
        className={expanded ? "overflow-visible" : "overflow-hidden"}
        style={{
          pointerEvents: expanded ? "auto" : "none",
        }}
      >
        <div className="flex flex-col gap-2 px-3 pt-0.5 pb-3">
          {rows.map((row) => (
            <div key={row.rowId} className="max-h-40 max-w-[36rem] overflow-auto font-mono text-sm leading-5">
              <div className="break-all whitespace-pre-wrap text-token-description-foreground">
                {row.text}
              </div>
            </div>
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
  rows: ThreadStageModel["composerShell"]["backgroundAgentRows"];
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
          <ChevronIcon expanded={expanded} />
        </QueueActionButton>
      </div>
      <motion.div
        initial={false}
        animate={{
          height: expanded ? "auto" : 0,
          opacity: expanded ? 1 : 0,
        }}
        transition={CODEX_MEASURED_TRANSITION}
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
  model: ThreadStageModel;
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
  const hasFixedPortalContent = (model.body.aboveComposerBlocks?.length ?? 0) > 0;
  const showQueuePanel = model.composerShell.pendingSteers.length > 0 || model.composerShell.queuedFollowUps.length > 0;
  const showBackgroundTerminals = model.composerShell.backgroundTerminalRows.length > 0;
  const showBackgroundAgents = model.composerShell.backgroundAgentRows.length > 0 && !model.composerShell.showApprovalMode;
  const showAuxiliaryLaneStack = showQueuePanel || showBackgroundTerminals || showBackgroundAgents;
  let sectionIndex = hasFixedPortalContent ? 1 : 0;

  const resolveRoundedTop = () => {
    const showRoundedTop = sectionIndex === 0;
    sectionIndex += 1;
    return showRoundedTop;
  };

  return (
    <div className="mx-auto flex w-full max-w-[var(--thread-composer-max-width)] flex-col px-panel pb-0">
      {showAuxiliaryLaneStack ? (
        <div className="flex flex-col px-3">
          {showQueuePanel ? (
            <QueuePanel
              model={model}
              actions={actions}
              showRoundedTop={resolveRoundedTop()}
            />
          ) : null}
          {showBackgroundTerminals ? (
            <BackgroundTerminalPanel
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
      ) : null}
      {model.composerShell.showRequestCards ? (
        <RequestCardStack model={model} actions={actions} />
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
