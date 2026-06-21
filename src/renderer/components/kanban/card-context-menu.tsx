import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from "react";
import * as ContextMenuPrimitive from "@radix-ui/react-context-menu";
import { ArrowLeft } from "lucide-react";
import { CheckmarkIcon } from "@/components/shared/icons";
import { NodexIconButton } from "@/components/ui/button";
import {
  NodexDropdownMessage,
  NodexDropdownSearchInput,
  NodexDropdownSectionLabel,
  NodexDropdownSeparator,
  NodexDropdownSurface,
} from "@/components/ui/dropdown";
import { cn } from "@/lib/utils";
import {
  getCardActionMenuEntries,
  getCardMoveTargets,
  type CardContextMenuProjectSummary,
} from "./card-context-menu-model";
import { CardContextMenuActionRowContent } from "./card-context-menu-row";
import type { Card as CardType } from "@/lib/types";

interface CardContextMenuProps {
  card: Pick<CardType, "id" | "created">;
  currentColumnId: string;
  currentProjectId: string;
  currentProjectName: string;
  projects: CardContextMenuProjectSummary[];
  onMoveToProject: (projectId: string) => Promise<void> | void;
  onDelete: (input: { cardId: string; columnId: string }) => Promise<void> | void;
  onCopyLink: (input: { cardId: string; projectId: string }) => Promise<void> | void;
  onMenuOpen?: () => void;
  showMockActions?: boolean;
  children: ReactNode;
}

type CardContextMenuView = "actions" | "move";
const CONTEXT_MENU_MOTION_CLASS_NAME = [
  "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-[0.985]",
].join(" ");
const CONTEXT_MENU_ITEM_CLASS_NAME = [
  "no-drag text-token-foreground outline-hidden rounded-lg px-[var(--padding-row-x)] py-[var(--padding-row-y)] text-sm",
  "focus:bg-token-list-hover-background data-highlighted:bg-token-list-hover-background",
  "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
].join(" ");

function focusMenuInput(input: HTMLInputElement | null) {
  if (!input) {
    return;
  }

  input.focus();
  const caretPosition = input.value.length;
  input.setSelectionRange(caretPosition, caretPosition);
}

function focusFirstMenuItem(container: HTMLDivElement | null) {
  if (!container) {
    return;
  }

  const firstItem = container.querySelector<HTMLElement>("[data-card-menu-item='true']:not([data-disabled])");
  firstItem?.focus();
}

function formatCreatedLabel(value: Date) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}

function getProjectBadgeLabel(project: { label: string; icon?: string }) {
  const icon = project.icon?.trim();
  if (icon) {
    return icon;
  }

  const initial = project.label.trim().slice(0, 1).toUpperCase();
  return initial || "?";
}

function CardContextMenuSectionFooter({
  currentProjectName,
  createdAt,
}: {
  currentProjectName: string;
  createdAt: Date;
}) {
  return (
    <div className="px-[var(--padding-row-x)] pt-0.5 pb-2 text-xs text-token-description-foreground">
      <div className="truncate">{currentProjectName}</div>
      <div className="truncate pt-0.5">Created {formatCreatedLabel(createdAt)}</div>
    </div>
  );
}

export function CardContextMenu({
  card,
  currentColumnId,
  currentProjectId,
  currentProjectName,
  projects,
  onMoveToProject,
  onDelete,
  onCopyLink,
  onMenuOpen,
  showMockActions = import.meta.env.DEV,
  children,
}: CardContextMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [view, setView] = useState<CardContextMenuView>("actions");
  const [actionQuery, setActionQuery] = useState("");
  const [moveQuery, setMoveQuery] = useState("");
  const hasInitialFocusRedirectRef = useRef(false);
  const actionInputRef = useRef<HTMLInputElement>(null);
  const moveInputRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const actions = getCardActionMenuEntries({ query: actionQuery, showMockActions });
  const moveTargets = getCardMoveTargets(projects, currentProjectId, moveQuery);
  const canCopyLink = typeof navigator !== "undefined" && typeof navigator.clipboard?.writeText === "function";

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const targetInput = view === "actions" ? actionInputRef.current : moveInputRef.current;
    requestAnimationFrame(() => focusMenuInput(targetInput));
  }, [isOpen, view]);

  const handleActionInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "ArrowDown") {
      return;
    }

    event.preventDefault();
    focusFirstMenuItem(contentRef.current);
  };

  const handleMoveInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      setView("actions");
      return;
    }

    if (event.key !== "ArrowDown") {
      return;
    }

    event.preventDefault();
    focusFirstMenuItem(contentRef.current);
  };

  return (
    <ContextMenuPrimitive.Root
      onOpenChange={(nextOpen) => {
        setIsOpen(nextOpen);

        if (nextOpen) {
          onMenuOpen?.();
        }

        hasInitialFocusRedirectRef.current = false;
        setView("actions");
        setActionQuery("");
        setMoveQuery("");
      }}
    >
      <ContextMenuPrimitive.Trigger asChild>
        {children}
      </ContextMenuPrimitive.Trigger>
      <ContextMenuPrimitive.Portal>
        <ContextMenuPrimitive.Content
          ref={contentRef}
          collisionPadding={8}
          onFocusCapture={(event) => {
            if (hasInitialFocusRedirectRef.current) {
              return;
            }

            if (view !== "actions") {
              return;
            }

            if (event.target === actionInputRef.current) {
              hasInitialFocusRedirectRef.current = true;
              return;
            }

            hasInitialFocusRedirectRef.current = true;
            requestAnimationFrame(() => focusMenuInput(actionInputRef.current));
          }}
          onEscapeKeyDown={(event) => {
            if (view !== "move") {
              return;
            }

            event.preventDefault();
            setView("actions");
          }}
          className={cn("z-50 no-drag outline-hidden", CONTEXT_MENU_MOTION_CLASS_NAME)}
        >
          <NodexDropdownSurface className={cn(view === "move" ? "w-[330px]" : "w-[265px]")}>
            <div className="flex flex-col">
              {view === "actions" ? (
                <>
                  <NodexDropdownSearchInput
                    ref={actionInputRef}
                    value={actionQuery}
                    onChange={(event) => setActionQuery(event.target.value)}
                    onKeyDown={handleActionInputKeyDown}
                    onPointerDown={(event) => event.stopPropagation()}
                    placeholder="Search actions…"
                  />

                  <NodexDropdownSectionLabel>Page</NodexDropdownSectionLabel>

                  {actions.length === 0 ? (
                    <NodexDropdownMessage compact>No actions found</NodexDropdownMessage>
                  ) : (
                    actions.map((entry) => (
                      <ContextMenuPrimitive.Item
                        key={entry.id}
                        disabled={entry.disabled || (entry.id === "copy-link" && !canCopyLink)}
                        data-card-menu-item="true"
                        onSelect={(event) => {
                          if (entry.id === "move-to") {
                            event.preventDefault();
                            setMoveQuery("");
                            setView("move");
                            return;
                          }

                          if (entry.id === "copy-link") {
                            void onCopyLink({
                              cardId: card.id,
                              projectId: currentProjectId,
                            });
                            return;
                          }

                          if (entry.id === "delete") {
                            void onDelete({
                              cardId: card.id,
                              columnId: currentColumnId,
                            });
                          }
                        }}
                        className={cn(CONTEXT_MENU_ITEM_CLASS_NAME, "flex w-full items-center gap-2")}
                      >
                        <CardContextMenuActionRowContent entry={entry} />
                      </ContextMenuPrimitive.Item>
                    ))
                  )}
                </>
              ) : (
                <>
                  <div className="flex items-center gap-1 px-[var(--padding-row-x)] py-[var(--padding-row-y)]">
                    <NodexIconButton
                      icon={ArrowLeft}
                      ariaLabel="Back to actions"
                      size="xs"
                      onClick={() => setView("actions")}
                    />
                    <NodexDropdownSearchInput
                      ref={moveInputRef}
                      value={moveQuery}
                      onChange={(event) => setMoveQuery(event.target.value)}
                      onKeyDown={handleMoveInputKeyDown}
                      onPointerDown={(event) => event.stopPropagation()}
                      placeholder="Move task to project…"
                      className="min-w-0 flex-1 px-0 py-0"
                    />
                  </div>

                  <NodexDropdownSectionLabel className="flex items-center gap-2">
                    <span className="truncate">Projects</span>
                    <span className="ml-auto shrink-0 tabular-nums">{projects.length}</span>
                  </NodexDropdownSectionLabel>

                  {moveTargets.length === 0 ? (
                    <NodexDropdownMessage compact>No projects found</NodexDropdownMessage>
                  ) : (
                    moveTargets.map((target) => (
                      <ContextMenuPrimitive.Item
                        key={target.id}
                        disabled={target.disabled}
                        data-card-menu-item="true"
                        onSelect={() => {
                          if (target.disabled) {
                            return;
                          }

                          void onMoveToProject(target.id);
                        }}
                        className={cn(CONTEXT_MENU_ITEM_CLASS_NAME, "flex min-h-[45px] w-full items-start gap-2")}
                      >
                        <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center text-xs text-token-description-foreground">
                          {getProjectBadgeLabel(target)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-token-foreground">
                            {target.label}
                          </span>
                          <span className="block truncate pt-0.5 text-xs text-token-description-foreground">
                            {target.description}
                          </span>
                        </span>
                        {target.isCurrent ? (
                          <CheckmarkIcon className="mt-0.5 shrink-0 text-token-description-foreground" />
                        ) : null}
                      </ContextMenuPrimitive.Item>
                    ))
                  )}
                </>
              )}

              <NodexDropdownSeparator />
              <CardContextMenuSectionFooter currentProjectName={currentProjectName} createdAt={card.created} />
            </div>
          </NodexDropdownSurface>
        </ContextMenuPrimitive.Content>
      </ContextMenuPrimitive.Portal>
    </ContextMenuPrimitive.Root>
  );
}
