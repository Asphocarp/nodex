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
} from "@/components/database/data-source-page-property-context-menu";
import type { DataSourcePagePropertyMenuSource } from "@/components/database/data-source-page-property-menu-source";
import {
  NodexContextMenuContent,
  NodexContextMenuItem,
  NodexContextMenuPortal,
  NodexContextMenuRoot,
  NodexContextMenuSubmenu,
  NodexContextMenuSubmenuTrigger,
  NodexContextMenuTrigger,
} from "@/components/ui/context-menu";
import { NodexDropdown } from "@/components/ui/dropdown";
import { NodexPopover, NodexPopoverAnchor, NodexPopoverContent } from "@/components/ui/popover";
import { toast } from "@/components/ui/toast";
import { NfmSendToThreadMenu } from "@/components/board/editor/nfm-send-to-thread-menu";
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
import {
  isDatabaseViewPageCopyActionId,
  resolveDatabaseViewPageCopyRequest,
} from "./database-view-page-copy-model";

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

function PageActionSubmenu({
  entry,
  onSelect,
}: {
  readonly entry: DatabaseViewPageMenuEntry;
  readonly onSelect: (actionId: DatabaseViewPageMenuActionId) => void;
}) {
  return (
    <NodexContextMenuSubmenu
      trigger={
        <NodexContextMenuSubmenuTrigger
          leftSlot={<DatabaseViewPageMenuActionIcon actionId={entry.id} />}
          rightSlot={<ChevronRightIcon className="icon-xs opacity-75" />}
        >
          {entry.label}
        </NodexContextMenuSubmenuTrigger>
      }
      alignOffset={-4}
      contentClassName="min-w-[220px]"
      renderContent={() => (
        <>
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
        </>
      )}
    />
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

export interface DatabaseViewPageMenuSession {
  readonly page: DatabaseViewPageTarget;
  readonly canMoveUp: boolean;
  readonly canMoveDown: boolean;
  readonly propertySource: DataSourcePagePropertyMenuSource;
  readonly groupingPropertyId?: string | null;
  readonly actionPort?: DatabaseViewPageActionPort;
  readonly deleteDisabled?: boolean;
  readonly onMove: (direction: DatabaseViewPageMoveDirection) => void;
}

const EMPTY_PAGE_ACTION_PORT: DatabaseViewPageActionPort = {};

export function DatabaseViewPageContextMenuOverlay({
  menuOpen,
  onMenuOpenChange,
  page,
  canMoveUp,
  canMoveDown,
  propertySource,
  groupingPropertyId = null,
  actionPort = EMPTY_PAGE_ACTION_PORT,
  deleteDisabled = false,
  onMove,
}: {
  readonly menuOpen: boolean;
  readonly onMenuOpenChange: (open: boolean) => void;
} & DatabaseViewPageMenuSession) {
  const [query, setQuery] = useState("");
  const [chatPicker, setChatPicker] = useState<ChatPickerState | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const redirectedInitialFocusRef = useRef(false);
  const presentedTitle = usePresentedPageTitle(page.pageId, page.titleSnapshot, page.libraryId);
  const presentedPage = { ...page, titleSnapshot: presentedTitle };
  const actions = filterDatabaseViewPageMenuEntries(
    buildDatabaseViewPageMenuEntries({
      hasPageKey: Boolean(page.pageKey),
      canMoveUp,
      canMoveDown,
      canCopyMarkdown: true,
      canOpenInNewSession: Boolean(page.projectId && actionPort.openInNewSession),
      canSendToChat: Boolean(page.projectId && actionPort.sendToChat),
      canDelete: Boolean(actionPort.deletePage) && !deleteDisabled,
    }),
    query,
  );
  const hasVisibleProperties = pagePropertyContextMenuHasMatches(propertySource.descriptors, query);

  const handleMenuOpenChange = (open: boolean): void => {
    onMenuOpenChange(open);
    redirectedInitialFocusRef.current = false;
    if (open) setChatPicker(null);
    if (!open) setQuery("");
  };

  useEffect(() => {
    if (menuOpen || !chatPicker || chatPicker.open) return;
    const frame = requestAnimationFrame(() => {
      setChatPicker((current) => (current ? { ...current, open: true } : null));
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

    if (isDatabaseViewPageCopyActionId(actionId)) {
      const request = resolveDatabaseViewPageCopyRequest({
        actionId,
        page,
        presentedTitle,
      });
      if (!request) return;
      if (request.kind === "value") {
        void copyWithFeedback(request.value, request.successMessage, request.failureMessage);
        return;
      }
      void loadPageDocumentMaterialization({
        accessContext: request.accessContext,
        pageId: request.pageId,
      })
        .then((materialized) =>
          copyWithFeedback(materialized.nfm, request.successMessage, request.failureMessage),
        )
        .catch(() => {
          toast.danger(request.failureMessage);
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
      void Promise.resolve()
        .then(() => actionPort.openInNewSession?.(pageChatInput))
        .catch(() => {
          toast.danger("Failed to open Page in a new session");
        });
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

  const selectActionAndClose = (actionId: DatabaseViewPageMenuActionId): void => {
    selectAction(actionId);
    handleMenuOpenChange(false);
  };

  const renderAction = (action: DatabaseViewPageMenuEntry, index: number): ReactNode => {
    const separator = action.id === "delete" && index > 0 ? <NodexDropdown.Separator /> : null;
    if (action.children) {
      return (
        <Fragment key={action.id}>
          {separator}
          <PageActionSubmenu entry={action} onSelect={selectActionAndClose} />
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
    <>
      <NodexContextMenuPortal>
        <NodexContextMenuContent
          ref={contentRef}
          onFocusCapture={(event) => {
            if (redirectedInitialFocusRef.current) return;
            redirectedInitialFocusRef.current = true;
            if (event.target === inputRef.current) return;
            queueMicrotask(() => inputRef.current?.focus());
          }}
          className="w-[265px]"
        >
          <NodexDropdown.SearchInput
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
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
                source={propertySource}
                groupingPropertyId={groupingPropertyId}
                query={query}
                onContextMenuCommit={() => handleMenuOpenChange(false)}
              />
            </>
          ) : null}
          {hasVisibleProperties && actions.length > 0 ? <NodexDropdown.Separator /> : null}
          {actions.map(renderAction)}
        </NodexContextMenuContent>
      </NodexContextMenuPortal>
      <ChatPicker
        state={chatPicker}
        page={presentedPage}
        actionPort={actionPort}
        onClose={() => setChatPicker(null)}
      />
    </>
  );
}

export function DatabaseViewPageContextMenu({
  children,
  ...session
}: {
  readonly children: ReactElement;
} & DatabaseViewPageMenuSession) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <NodexContextMenuRoot open={menuOpen} onOpenChange={setMenuOpen}>
      <NodexContextMenuTrigger className="contents">{children}</NodexContextMenuTrigger>
      <DatabaseViewPageContextMenuOverlay
        {...session}
        menuOpen={menuOpen}
        onMenuOpenChange={setMenuOpen}
      />
    </NodexContextMenuRoot>
  );
}
