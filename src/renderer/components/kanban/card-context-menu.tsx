import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import * as ContextMenuPrimitive from "@radix-ui/react-context-menu";
import {
  NodexDropdownMessage,
  NodexDropdownSearchInput,
  NodexDropdownSectionLabel,
  NodexDropdownSeparator,
  NodexDropdownSurface,
} from "@/components/ui/dropdown";
import { cn } from "@/lib/utils";
import { getPageActionMenuEntries } from "./card-context-menu-model";
import { CardContextMenuActionRowContent } from "./card-context-menu-row";
import type { DatabasePage as CardType } from "@/lib/types";

interface CardContextMenuProps {
  card: Pick<CardType, "id" | "created">;
  currentColumnId: string;
  currentProjectId: string;
  currentProjectName: string;
  onDelete: (input: { pageId: string; columnId: string }) => Promise<void> | void;
  onCopyLink: (input: { pageId: string; projectId: string }) => Promise<void> | void;
  onMenuOpen?: () => void;
  showMockActions?: boolean;
  children: ReactNode;
}

const CONTEXT_MENU_MOTION_CLASS_NAME = [
  "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-[0.985]",
].join(" ");
const CONTEXT_MENU_ITEM_CLASS_NAME = [
  "no-drag text-token-foreground outline-hidden rounded-lg px-[var(--padding-row-x)] py-[var(--padding-row-y)] text-sm",
  "focus:bg-token-list-hover-background data-highlighted:bg-token-list-hover-background",
  "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
].join(" ");

const focusMenuInput = (input: HTMLInputElement | null): void => {
  if (!input) return;
  input.focus();
  const caretPosition = input.value.length;
  input.setSelectionRange(caretPosition, caretPosition);
};

const focusFirstMenuItem = (container: HTMLDivElement | null): void => {
  if (!container) return;
  container
    .querySelector<HTMLElement>(
      "[data-card-menu-item='true']:not([data-disabled])",
    )
    ?.focus();
};

const formatCreatedLabel = (value: Date): string =>
  new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(value);

function CardContextMenuSectionFooter({
  currentProjectName,
  createdAt,
}: {
  readonly currentProjectName: string;
  readonly createdAt: Date;
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
  onDelete,
  onCopyLink,
  onMenuOpen,
  showMockActions = import.meta.env.DEV,
  children,
}: CardContextMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [actionQuery, setActionQuery] = useState("");
  const hasInitialFocusRedirectRef = useRef(false);
  const actionInputRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const actions = getPageActionMenuEntries({
    query: actionQuery,
    showMockActions,
  });
  const canCopyLink = typeof navigator !== "undefined"
    && typeof navigator.clipboard?.writeText === "function";

  useEffect(() => {
    if (!isOpen) return;
    requestAnimationFrame(() => focusMenuInput(actionInputRef.current));
  }, [isOpen]);

  const handleActionInputKeyDown = (
    event: KeyboardEvent<HTMLInputElement>,
  ): void => {
    if (event.key !== "ArrowDown") return;
    event.preventDefault();
    focusFirstMenuItem(contentRef.current);
  };

  return (
    <ContextMenuPrimitive.Root
      onOpenChange={(nextOpen) => {
        setIsOpen(nextOpen);
        if (nextOpen) onMenuOpen?.();
        hasInitialFocusRedirectRef.current = false;
        setActionQuery("");
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
            if (hasInitialFocusRedirectRef.current) return;
            if (event.target === actionInputRef.current) {
              hasInitialFocusRedirectRef.current = true;
              return;
            }
            hasInitialFocusRedirectRef.current = true;
            requestAnimationFrame(() => focusMenuInput(actionInputRef.current));
          }}
          className={cn(
            "z-50 no-drag outline-hidden",
            CONTEXT_MENU_MOTION_CLASS_NAME,
          )}
        >
          <NodexDropdownSurface className="w-[265px]">
            <div className="flex flex-col">
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
                    onSelect={() => {
                      if (entry.id === "copy-link") {
                        void onCopyLink({
                          pageId: card.id,
                          projectId: currentProjectId,
                        });
                        return;
                      }
                      if (entry.id !== "delete") return;
                      void onDelete({
                        pageId: card.id,
                        columnId: currentColumnId,
                      });
                    }}
                    className={cn(
                      CONTEXT_MENU_ITEM_CLASS_NAME,
                      "flex w-full items-center gap-2",
                    )}
                  >
                    <CardContextMenuActionRowContent entry={entry} />
                  </ContextMenuPrimitive.Item>
                ))
              )}

              <NodexDropdownSeparator />
              <CardContextMenuSectionFooter
                currentProjectName={currentProjectName}
                createdAt={card.created}
              />
            </div>
          </NodexDropdownSurface>
        </ContextMenuPrimitive.Content>
      </ContextMenuPrimitive.Portal>
    </ContextMenuPrimitive.Root>
  );
}
