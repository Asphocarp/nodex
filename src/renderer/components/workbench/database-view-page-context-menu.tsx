import * as ContextMenuPrimitive from "@radix-ui/react-context-menu";
import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from "react";

import {
  ChevronRightIcon,
  PageMenuCopyIcon,
  PageMenuCopyIdIcon,
  PageMenuCopyLinkIcon,
  PageMenuCopyMarkdownIcon,
  PageMenuCopyTitleIcon,
  PageMenuDeleteIcon,
  PageMenuMoveBottomIcon,
  PageMenuMoveDownIcon,
  PageMenuMoveIcon,
  PageMenuMoveTopIcon,
  PageMenuMoveUpIcon,
  PageMenuOpenInIcon,
  PageMenuOpenNewSessionIcon,
  SidePanelSideChatIcon,
} from "@/components/shared/icons";
import {
  DataSourcePagePropertyContextMenuItems,
  pagePropertyContextMenuHasMatches,
  type DataSourcePropertyEditorBinding,
} from "@/components/database/data-source-page-property-context-menu";
import {
  NodexContextMenuContent,
  NodexContextMenuItem,
  NodexContextMenuSubContent,
  NodexContextMenuSubTrigger,
} from "@/components/ui/context-menu";
import { NodexDropdown } from "@/components/ui/dropdown";
import {
  NodexPopover,
  NodexPopoverAnchor,
  NodexPopoverContent,
} from "@/components/ui/popover";
import { toast } from "@/components/ui/toast";
import { NfmSendToThreadMenu } from "@/components/board/editor/nfm-send-to-thread-menu";
import { buildPageDeepLink } from "@/lib/page-deeplink";
import { writeTextToClipboard } from "@/lib/clipboard";
import { loadPageDocumentMaterialization } from "@/lib/page-prompt-context";
import { usePresentedPageTitle } from "@/lib/page-title-projection-context";
import type {
  DatabaseViewPageActionPort,
  DatabaseViewPageTarget,
} from "./database-view-page-actions";
import {
  buildDatabaseViewPageMenuEntries,
  databaseViewPageMoveDirection,
  filterDatabaseViewPageMenuEntries,
  type DatabaseViewPageMenuActionId,
  type DatabaseViewPageMenuEntry,
  type DatabaseViewPageMoveDirection,
} from "./database-view-page-menu-model";

interface ChatPickerState {
  readonly anchorRect: DOMRect;
  readonly open: boolean;
}

const copyWithFeedback = async (
  value: string,
  successMessage: string,
  failureMessage: string,
): Promise<void> => {
  const copied = await writeTextToClipboard(value);
  if (copied) {
    toast.success(successMessage);
    return;
  }
  toast.danger(failureMessage);
};

function DatabaseViewPageMenuActionIcon({
  actionId,
}: {
  readonly actionId: DatabaseViewPageMenuActionId;
}) {
  switch (actionId) {
    case "move":
      return <PageMenuMoveIcon />;
    case "move-top":
      return <PageMenuMoveTopIcon />;
    case "move-up":
      return <PageMenuMoveUpIcon />;
    case "move-down":
      return <PageMenuMoveDownIcon />;
    case "move-bottom":
      return <PageMenuMoveBottomIcon />;
    case "copy":
      return <PageMenuCopyIcon />;
    case "copy-id":
      return <PageMenuCopyIdIcon />;
    case "copy-deeplink":
      return <PageMenuCopyLinkIcon />;
    case "copy-title":
      return <PageMenuCopyTitleIcon />;
    case "copy-markdown":
      return <PageMenuCopyMarkdownIcon />;
    case "open-in":
      return <PageMenuOpenInIcon />;
    case "open-in-new-session":
      return <PageMenuOpenNewSessionIcon />;
    case "send-to-chat":
      return <SidePanelSideChatIcon />;
    case "delete":
      return <PageMenuDeleteIcon />;
  }
}

function ImmediatePageActionSubmenu({
  entry,
  open,
  onOpenChange,
  onSelect,
}: {
  readonly entry: DatabaseViewPageMenuEntry;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSelect: (actionId: DatabaseViewPageMenuActionId) => void;
}) {
  return (
    <ContextMenuPrimitive.Sub open={open} onOpenChange={onOpenChange}>
      <NodexContextMenuSubTrigger
        leftSlot={<DatabaseViewPageMenuActionIcon actionId={entry.id} />}
        rightSlot={<ChevronRightIcon className="icon-xs opacity-75" />}
        onPointerMove={(event) => {
          if (event.pointerType === "touch") return;
          const isVerticalSweep = Math.abs(event.movementX) <= 1
            && Math.abs(event.movementY) > 1;
          // Radix marks pointer moves inside its submenu grace polygon as
          // prevented later in this same event. Preserve that protection for
          // diagonal seam travel, but let an unambiguously vertical sweep move
          // directly between sibling triggers.
          queueMicrotask(() => {
            if (!event.defaultPrevented || isVerticalSweep) onOpenChange(true);
          });
        }}
      >
        {entry.label}
      </NodexContextMenuSubTrigger>
      <ContextMenuPrimitive.Portal>
        <NodexContextMenuSubContent
          sideOffset={0}
          alignOffset={-4}
          className="min-w-[220px]"
        >
          {entry.children?.map((child) => (
            <NodexContextMenuItem
              key={child.id}
              disabled={child.disabled}
              leftSlot={<DatabaseViewPageMenuActionIcon actionId={child.id} />}
              onSelect={() => onSelect(child.id)}
            >
              {child.label}
            </NodexContextMenuItem>
          ))}
        </NodexContextMenuSubContent>
      </ContextMenuPrimitive.Portal>
    </ContextMenuPrimitive.Sub>
  );
}

function ChatPicker({
  state,
  page,
  actionPort,
  onClose,
}: {
  readonly state: ChatPickerState | null;
  readonly page: DatabaseViewPageTarget;
  readonly actionPort: DatabaseViewPageActionPort;
  readonly onClose: () => void;
}) {
  const projectId = page.projectId;
  if (!state || !projectId || !actionPort.sendToChat) return null;

  return (
    <NodexPopover
      open={state.open}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <NodexPopoverAnchor asChild>
        <span
          aria-hidden="true"
          className="pointer-events-none fixed size-px"
          style={{
            left: state.anchorRect.left,
            top: state.anchorRect.bottom,
          }}
        />
      </NodexPopoverAnchor>
      {state.open ? (
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
            projectId={projectId}
            onAccept={async ({ target }) => {
              await actionPort.sendToChat?.({
                projectId,
                pageId: page.pageId,
                ...(page.pageKey ? { pageKey: page.pageKey } : {}),
                titleSnapshot: page.titleSnapshot,
                target,
              });
              onClose();
            }}
            onClose={onClose}
            showModeSelector={false}
          />
        </NodexPopoverContent>
      ) : null}
    </NodexPopover>
  );
}

export function DatabaseViewPageContextMenu({
  children,
  page,
  canMoveUp,
  canMoveDown,
  propertyBindings,
  groupingPropertyId = null,
  actionPort = {},
  deleteDisabled = false,
  onMove,
}: {
  readonly children: ReactElement;
  readonly page: DatabaseViewPageTarget;
  readonly canMoveUp: boolean;
  readonly canMoveDown: boolean;
  readonly propertyBindings: readonly DataSourcePropertyEditorBinding[];
  readonly groupingPropertyId?: string | null;
  readonly actionPort?: DatabaseViewPageActionPort;
  readonly deleteDisabled?: boolean;
  readonly onMove: (direction: DatabaseViewPageMoveDirection) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeSubmenuId, setActiveSubmenuId] = useState<DatabaseViewPageMenuActionId | null>(null);
  const [chatPicker, setChatPicker] = useState<ChatPickerState | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const redirectedInitialFocusRef = useRef(false);
  const presentedTitle = usePresentedPageTitle(
    page.pageId,
    page.titleSnapshot,
    page.libraryId,
  );
  const presentedPage = { ...page, titleSnapshot: presentedTitle };
  const actions = filterDatabaseViewPageMenuEntries(
    buildDatabaseViewPageMenuEntries({
      hasPageKey: Boolean(page.pageKey),
      canMoveUp,
      canMoveDown,
      canCopyMarkdown: Boolean(page.projectId),
      canOpenInNewSession: Boolean(page.projectId && actionPort.openInNewSession),
      canSendToChat: Boolean(page.projectId && actionPort.sendToChat),
      canDelete: Boolean(actionPort.deletePage) && !deleteDisabled,
    }),
    query,
  );
  const hasVisibleProperties = pagePropertyContextMenuHasMatches(propertyBindings, query);

  const handleMenuOpenChange = (open: boolean): void => {
    setMenuOpen(open);
    redirectedInitialFocusRef.current = false;
    setActiveSubmenuId(null);
    if (open) setChatPicker(null);
    if (!open) setQuery("");
  };

  useEffect(() => {
    if (menuOpen || !chatPicker || chatPicker.open) return;
    const frame = requestAnimationFrame(() => {
      setChatPicker((current) => current ? { ...current, open: true } : null);
    });
    return () => cancelAnimationFrame(frame);
  }, [chatPicker, menuOpen]);

  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key !== "ArrowDown") return;
    const firstItem = contentRef.current?.querySelector<HTMLElement>(
      '[role="menuitem"]:not([data-disabled])',
    );
    if (!firstItem) return;
    event.preventDefault();
    firstItem.focus();
  };

  const selectAction = (actionId: DatabaseViewPageMenuActionId): void => {
    const moveDirection = databaseViewPageMoveDirection(actionId);
    if (moveDirection) {
      onMove(moveDirection);
      return;
    }

    if (actionId === "copy-id" && page.pageKey) {
      void copyWithFeedback(page.pageKey, "Copied ID", "Failed to copy ID");
      return;
    }
    if (actionId === "copy-deeplink") {
      void copyWithFeedback(
        buildPageDeepLink({ pageId: page.pageId }),
        "Copied deeplink",
        "Failed to copy deeplink",
      );
      return;
    }
    if (actionId === "copy-title") {
      void copyWithFeedback(
        presentedTitle.trim() || "Untitled Page",
        "Copied title",
        "Failed to copy title",
      );
      return;
    }
    if (actionId === "copy-markdown" && page.projectId) {
      void loadPageDocumentMaterialization({
        projectId: page.projectId,
        pageId: page.pageId,
      }).then((materialized) => copyWithFeedback(
        materialized.nfm,
        "Copied content as Markdown",
        "Failed to copy content",
      )).catch(() => {
        toast.danger("Failed to copy content");
      });
      return;
    }

    const pageChatInput = page.projectId
      ? {
          projectId: page.projectId,
          pageId: page.pageId,
          ...(page.pageKey ? { pageKey: page.pageKey } : {}),
          titleSnapshot: presentedTitle,
        }
      : null;
    if (actionId === "open-in-new-session" && pageChatInput) {
      void actionPort.openInNewSession?.(pageChatInput);
      return;
    }
    if (actionId === "send-to-chat") {
      const anchorRect = contentRef.current?.getBoundingClientRect();
      if (anchorRect) setChatPicker({ anchorRect, open: false });
      return;
    }
    if (actionId !== "delete" || !actionPort.deletePage) return;
    void Promise.resolve()
      .then(() => actionPort.deletePage?.(presentedPage))
      .catch(() => {
        toast.danger("Failed to delete Page");
      });
  };

  const selectActionAndClose = (
    actionId: DatabaseViewPageMenuActionId,
  ): void => {
    selectAction(actionId);
    handleMenuOpenChange(false);
  };

  const renderAction = (
    action: DatabaseViewPageMenuEntry,
    index: number,
  ): ReactNode => {
    const separator = action.id === "delete" && index > 0
      ? <NodexDropdown.Separator />
      : null;
    if (action.children) {
      return (
        <Fragment key={action.id}>
          {separator}
          <ImmediatePageActionSubmenu
            entry={action}
            open={activeSubmenuId === action.id}
            onOpenChange={(open) => setActiveSubmenuId((current) => {
              if (open) return action.id;
              return current === action.id ? null : current;
            })}
            onSelect={selectActionAndClose}
          />
        </Fragment>
      );
    }
    return (
      <Fragment key={action.id}>
        {separator}
        <NodexContextMenuItem
          disabled={action.disabled}
          tone={action.id === "delete" ? "danger" : "default"}
          leftSlot={<DatabaseViewPageMenuActionIcon actionId={action.id} />}
          onSelect={() => selectActionAndClose(action.id)}
        >
          {action.label}
        </NodexContextMenuItem>
      </Fragment>
    );
  };

  return (
    <ContextMenuPrimitive.Root
      open={menuOpen}
      onOpenChange={handleMenuOpenChange}
    >
      <ContextMenuPrimitive.Trigger className="contents">
        {children}
      </ContextMenuPrimitive.Trigger>
      <ContextMenuPrimitive.Portal>
        <NodexContextMenuContent
          ref={contentRef}
          onFocusCapture={(event) => {
            if (redirectedInitialFocusRef.current) return;
            redirectedInitialFocusRef.current = true;
            if (event.target === inputRef.current) return;
            requestAnimationFrame(() => inputRef.current?.focus());
          }}
          className="w-[265px]"
        >
          <NodexDropdown.SearchInput
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveSubmenuId(null);
            }}
            onKeyDown={handleSearchKeyDown}
            onPointerDown={(event) => event.stopPropagation()}
            placeholder="Search actions and properties…"
            aria-label="Search Page actions and properties"
          />
          {!hasVisibleProperties && actions.length === 0 ? (
            <NodexDropdown.Message compact>No actions found</NodexDropdown.Message>
          ) : null}
          {hasVisibleProperties ? (
            <>
              <NodexDropdown.SectionLabel>Properties</NodexDropdown.SectionLabel>
              <DataSourcePagePropertyContextMenuItems
                bindings={propertyBindings}
                groupingPropertyId={groupingPropertyId}
                query={query}
                onContextMenuCommit={() => handleMenuOpenChange(false)}
              />
            </>
          ) : null}
          {hasVisibleProperties && actions.length > 0 ? <NodexDropdown.Separator /> : null}
          {actions.map(renderAction)}
        </NodexContextMenuContent>
      </ContextMenuPrimitive.Portal>
      <ChatPicker
        state={chatPicker}
        page={presentedPage}
        actionPort={actionPort}
        onClose={() => setChatPicker(null)}
      />
    </ContextMenuPrimitive.Root>
  );
}
