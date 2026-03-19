import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { ThreadStageActions, ThreadStageModel } from "../thread-stage-types";
import { LOCAL_CONVERSATION_QUEUE_ABOVE_COMPOSER_PORTAL_ID } from "./local-conversation-above-composer-portal";
import {
  SELECTOR_MENU_CONTENT_CLASS_NAME,
  SELECTOR_MENU_ITEM_CLASS_NAME,
  SELECTOR_MENU_LIST_CLASS_NAME,
  SELECTOR_MENU_PANEL_CLASS_NAME,
} from "./shared/selector-popover-primitives";
import { usePortalHost } from "./use-portal-host";

interface LocalConversationAboveComposerQueuePortalProps {
  model: ThreadStageModel;
  actions: ThreadStageActions;
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

function QueueCard({
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

export function LocalConversationAboveComposerQueuePortal({
  model,
  actions,
}: LocalConversationAboveComposerQueuePortalProps) {
  const queueSurface = model.aboveComposerQueueSurface;
  const threadId = model.conversation?.threadId ?? null;
  const hasFixedPortalContent = (model.body.aboveComposerBlocks?.length ?? 0) > 0;
  const host = usePortalHost(LOCAL_CONVERSATION_QUEUE_ABOVE_COMPOSER_PORTAL_ID);
  const [draggingFollowUpId, setDraggingFollowUpId] = useState<string | null>(null);

  const pendingSteers = useMemo(
    () => queueSurface?.entries.filter((entry) => entry.kind === "pendingSteer") ?? [],
    [queueSurface?.entries],
  );
  const queuedFollowUps = useMemo(
    () => queueSurface?.entries.filter((entry) => entry.kind === "queuedFollowUp") ?? [],
    [queueSurface?.entries],
  );

  if (!queueSurface || !threadId) return null;
  if (!host) return null;
  const hasQueueRows = pendingSteers.length > 0 || queuedFollowUps.length > 0;
  const showQueueRoundedTop = !hasFixedPortalContent;

  const handleDropFollowUp = async (targetFollowUpId: string) => {
    if (!draggingFollowUpId || draggingFollowUpId === targetFollowUpId) return;
    const orderedFollowUpIds = queuedFollowUps.map((entry) => entry.followUp.followUpId);
    const fromIndex = orderedFollowUpIds.indexOf(draggingFollowUpId);
    const toIndex = orderedFollowUpIds.indexOf(targetFollowUpId);
    if (fromIndex < 0 || toIndex < 0) return;

    const nextOrdered = [...orderedFollowUpIds];
    const [moved] = nextOrdered.splice(fromIndex, 1);
    if (!moved) return;
    nextOrdered.splice(toIndex, 0, moved);
    await actions.onReorderQueuedFollowUps(threadId, nextOrdered);
  };

  return createPortal(
    <div className="order-2 flex flex-col">
      {hasQueueRows ? (
        <QueueCard showRoundedTop={showQueueRoundedTop}>
          <div className="vertical-scroll-fade-mask flex max-h-[30dvh] flex-col gap-px overflow-y-auto px-5 py-row-y">
            {pendingSteers.map((entry) => (
              <div key={entry.steer.steerId} className="flex min-w-0 items-center justify-between gap-2 py-0.5 text-sm">
                <span className="flex min-w-0 flex-1 items-center gap-1.5">
                  <SteerIcon />
                  <span className="line-clamp-2 min-w-0 flex-1 leading-4 text-token-description-foreground">{entry.steer.prompt}</span>
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
              const followUpId = entry.followUp.followUpId;
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
                      {entry.followUp.prompt}
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
                                    prompt: entry.followUp.prompt,
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
                                  if (!model.isQueueingEnabled) return;
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
        </QueueCard>
      ) : null}

    </div>,
    host,
  );
}
