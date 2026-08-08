import {
  Fragment,
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
import {
  NodexPopover,
  NodexPopoverAnchor,
  NodexPopoverContent,
} from "@/components/ui/popover";
import { getPageActionMenuEntries } from "./card-context-menu-model";
import { CardContextMenuActionRowContent } from "./card-context-menu-row";
import { NfmSendToThreadMenu } from "./editor/nfm-send-to-thread-menu";
import type { DatabasePage as CardType } from "@/lib/types";
import type {
  OpenPageInNewChatInput,
  SendPageToChatInput,
} from "@/lib/page-chat-actions";

interface CardContextMenuProps {
  card: Pick<CardType, "id" | "created"> & Partial<Pick<CardType, "title" | "pageKey">>;
  currentColumnId: string;
  currentProjectId: string;
  currentProjectName: string;
  onDelete: (input: { pageId: string; columnId: string }) => Promise<void> | void;
  onCopyPageKey: (input: { pageKey: string }) => Promise<void> | void;
  onCopyLink: (input: { pageId: string; projectId: string }) => Promise<void> | void;
  onOpenPage?: (input: OpenPageInNewChatInput) => Promise<void> | void;
  onOpenPageInNewChat?: (input: OpenPageInNewChatInput) => Promise<void> | void;
  onSendPageToChat?: (input: SendPageToChatInput) => Promise<void> | void;
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
  onCopyPageKey,
  onCopyLink,
  onOpenPage,
  onOpenPageInNewChat,
  onSendPageToChat,
  onMenuOpen,
  showMockActions = import.meta.env.DEV,
  children,
}: CardContextMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [chatPicker, setChatPicker] = useState<{
    readonly anchorRect: DOMRect;
    readonly open: boolean;
  } | null>(null);
  const [actionQuery, setActionQuery] = useState("");
  const hasInitialFocusRedirectRef = useRef(false);
  const actionInputRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const actions = getPageActionMenuEntries({
    query: actionQuery,
    showMockActions,
    hasPageKey: Boolean(card.pageKey),
  });
  const pageActionInput = {
    projectId: currentProjectId,
    pageId: card.id,
    pageKey: card.pageKey ?? undefined,
    titleSnapshot: card.title,
  };
  const canCopyLink =
    typeof navigator !== "undefined"
    && typeof navigator.clipboard?.writeText === "function";

  useEffect(() => {
    if (!isOpen) return;
    requestAnimationFrame(() => focusMenuInput(actionInputRef.current));
  }, [isOpen]);

  useEffect(() => {
    if (isOpen || !chatPicker || chatPicker.open) return;
    const frame = requestAnimationFrame(() => {
      setChatPicker((current) => current ? { ...current, open: true } : null);
    });
    return () => cancelAnimationFrame(frame);
  }, [chatPicker, isOpen]);

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
        if (nextOpen) setChatPicker(null);
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
                actions.map((entry) => {
                  const isActionUnavailable =
                    (entry.id === "open-page" && !onOpenPage)
                    || (entry.id === "open-in-new-chat" && !onOpenPageInNewChat)
                    || (entry.id === "send-to-chat" && !onSendPageToChat);
                  return (
                    <Fragment key={entry.id}>
                      {entry.id === "copy-page-key" ? <NodexDropdownSeparator /> : null}
                      <ContextMenuPrimitive.Item
                        disabled={entry.disabled
                          || isActionUnavailable
                          || (entry.id === "copy-link" && !canCopyLink)}
                        data-card-menu-item="true"
                        onSelect={() => {
                          if (entry.id === "copy-link") {
                            void onCopyLink({
                              pageId: card.id,
                              projectId: currentProjectId,
                            });
                            return;
                          }
                          if (entry.id === "copy-page-key" && card.pageKey) {
                            void onCopyPageKey({ pageKey: card.pageKey });
                            return;
                          }
                          if (entry.id === "delete") {
                            void onDelete({
                              pageId: card.id,
                              columnId: currentColumnId,
                            });
                            return;
                          }
                          if (entry.id === "open-page") {
                            void onOpenPage?.(pageActionInput);
                            return;
                          }
                          if (entry.id === "open-in-new-chat") {
                            void onOpenPageInNewChat?.(pageActionInput);
                            return;
                          }
                          if (entry.id !== "send-to-chat") return;
                          const anchorRect = contentRef.current?.getBoundingClientRect();
                          if (!anchorRect) return;
                          setChatPicker({ anchorRect, open: false });
                        }}
                        className={cn(
                          CONTEXT_MENU_ITEM_CLASS_NAME,
                          "flex w-full items-center gap-2",
                        )}
                      >
                        <CardContextMenuActionRowContent entry={entry} />
                      </ContextMenuPrimitive.Item>
                    </Fragment>
                  );
                })
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
      <NodexPopover
        open={chatPicker?.open ?? false}
        onOpenChange={(open) => {
          if (!open) setChatPicker(null);
        }}
      >
        {chatPicker ? (
          <NodexPopoverAnchor asChild>
            <span
              aria-hidden="true"
              className="pointer-events-none fixed size-px"
              style={{
                left: chatPicker.anchorRect.left,
                top: chatPicker.anchorRect.bottom,
              }}
            />
          </NodexPopoverAnchor>
        ) : null}
        {chatPicker?.open ? (
          <NodexPopoverContent
            align="start"
            side="bottom"
            sideOffset={6}
            className="w-[330px] max-w-[calc(100vw-24px)] overflow-hidden p-1"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
            onCloseAutoFocus={(event) => event.preventDefault()}
          >
            <NfmSendToThreadMenu
              projectId={currentProjectId}
              onAccept={async ({ target }) => {
                if (!onSendPageToChat) return;
                await onSendPageToChat({
                  ...pageActionInput,
                  target,
                });
                setChatPicker(null);
              }}
              onClose={() => setChatPicker(null)}
              showModeSelector={false}
            />
          </NodexPopoverContent>
        ) : null}
      </NodexPopover>
    </ContextMenuPrimitive.Root>
  );
}
