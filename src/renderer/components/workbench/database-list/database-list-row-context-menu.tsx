import * as ContextMenuPrimitive from "@radix-ui/react-context-menu";
import {
  Fragment,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
} from "react";

import { NodexDropdown } from "@/components/ui/dropdown";
import { APP_SHELL_FLOATING_UI_LAYER_CLASS } from "@/lib/app-shell-layers";
import { copyPageKeyWithFeedback } from "@/lib/copy-page-key";
import { cn } from "@/lib/utils";
import {
  buildDatabaseListRowCommands,
  databaseListMoveDirection,
  type DatabaseListCommand,
  type DatabaseListMoveDirection,
} from "./database-list-commands";

const ITEM_CLASS_NAME = cn(
  "cursor-interaction rounded-lg px-[var(--padding-row-x)] py-[var(--padding-row-y)] text-sm outline-hidden",
  "text-token-foreground hover:bg-token-list-hover-background focus:bg-token-list-hover-background",
  "data-[disabled]:pointer-events-none data-[disabled]:opacity-45",
);

export function DatabaseListRowContextMenu({
  children,
  selected,
  canMoveUp,
  canMoveDown,
  pageKey,
  onOpen,
  onSelectOnly,
  onToggleSelection,
  onMove,
}: {
  readonly children: ReactElement;
  readonly selected: boolean;
  readonly canMoveUp: boolean;
  readonly canMoveDown: boolean;
  readonly pageKey: string | null;
  readonly onOpen: () => void;
  readonly onSelectOnly: () => void;
  readonly onToggleSelection: () => void;
  readonly onMove: (direction: DatabaseListMoveDirection) => void;
}) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const redirectedInitialFocusRef = useRef(false);
  const commands = buildDatabaseListRowCommands({
    selected,
    hasPageKey: Boolean(pageKey),
    canMoveUp,
    canMoveDown,
  });
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleCommands = normalizedQuery
    ? commands.filter((command) =>
        command.label.toLocaleLowerCase().includes(normalizedQuery)
      )
    : commands;
  const invoke = (command: DatabaseListCommand): void => {
    if (command.id === "open") {
      onOpen();
      return;
    }
    if (command.id === "copy-page-key") {
      if (pageKey) void copyPageKeyWithFeedback(pageKey);
      return;
    }
    if (command.id === "select-only") {
      onSelectOnly();
      return;
    }
    if (command.id === "toggle-selection") {
      onToggleSelection();
      return;
    }
    const direction = databaseListMoveDirection(command.id);
    if (direction) onMove(direction);
  };
  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key !== "ArrowDown") return;
    const firstItem = contentRef.current?.querySelector<HTMLElement>(
      '[role="menuitem"]:not([data-disabled])',
    );
    if (!firstItem) return;
    event.preventDefault();
    firstItem.focus();
  };
  return (
    <ContextMenuPrimitive.Root onOpenChange={(open) => {
      redirectedInitialFocusRef.current = false;
      if (!open) setQuery("");
    }}>
      <ContextMenuPrimitive.Trigger className="contents">
        {children}
      </ContextMenuPrimitive.Trigger>
      <ContextMenuPrimitive.Portal>
        <ContextMenuPrimitive.Content
          ref={contentRef}
          collisionPadding={8}
          onFocusCapture={(event) => {
            if (redirectedInitialFocusRef.current) return;
            redirectedInitialFocusRef.current = true;
            if (event.target === inputRef.current) return;
            requestAnimationFrame(() => inputRef.current?.focus());
          }}
          className={cn(
            "no-drag w-[265px] outline-hidden",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-[0.98]",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-[0.98]",
            APP_SHELL_FLOATING_UI_LAYER_CLASS,
          )}
        >
          <NodexDropdown.Surface className="w-[265px]">
            <NodexDropdown.SearchInput
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={handleSearchKeyDown}
              onPointerDown={(event) => event.stopPropagation()}
              placeholder="Search actions…"
              aria-label="Search Page actions"
            />
            {visibleCommands.length === 0 ? (
              <NodexDropdown.Message compact>No actions found</NodexDropdown.Message>
            ) : visibleCommands.map((command, index) => {
              const previous = visibleCommands[index - 1];
              const separated = previous !== undefined
                && previous.section !== command.section;
              return (
                <Fragment key={command.id}>
                  {separated ? <NodexDropdown.Separator /> : null}
                  <ContextMenuPrimitive.Item
                    className={ITEM_CLASS_NAME}
                    disabled={command.disabled}
                    onSelect={() => invoke(command)}
                  >
                    {command.label}
                  </ContextMenuPrimitive.Item>
                </Fragment>
              );
            })}
          </NodexDropdown.Surface>
        </ContextMenuPrimitive.Content>
      </ContextMenuPrimitive.Portal>
    </ContextMenuPrimitive.Root>
  );
}
