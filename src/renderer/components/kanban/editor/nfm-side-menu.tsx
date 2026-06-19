import {
  blockHasType,
  editorHasBlockWithType,
} from "@blocknote/core";
import {
  FormattingToolbarExtension,
  ShowSelectionExtension,
  SideMenuExtension,
  SuggestionMenu,
} from "@blocknote/core/extensions";
import {
  useBlockNoteEditor,
  useComponentsContext,
  useDictionary,
  useExtension,
  useExtensionState,
} from "@blocknote/react";
import {
  Plus,
} from "lucide-react";
import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  CheckmarkIcon,
  CodeBracketsIcon,
  NfmSideMenuAiFaceIcon,
  NfmSideMenuBulletedListBlockIcon,
  NfmSideMenuChevronRightIcon,
  NfmSideMenuCheckListBlockIcon,
  NfmSideMenuCodeBlockIcon,
  NfmSideMenuColorIcon,
  NfmSideMenuCommentIcon,
  NfmSideMenuCopyLinkIcon,
  NfmSideMenuDeleteIcon,
  NfmSideMenuDragHandleIcon,
  NfmSideMenuDuplicateIcon,
  NfmSideMenuHeadingBlockIcon,
  NfmSideMenuMoveToIcon,
  NfmSideMenuNumberedListBlockIcon,
  NfmSideMenuPageInIcon,
  NfmSideMenuPlayIcon,
  NfmSideMenuQuoteBlockIcon,
  NfmSideMenuSendBlocksIcon,
  NfmSideMenuSuggestEditsIcon,
  NfmSideMenuTableHeaderIcon,
  NfmSideMenuTextBlockIcon,
  NfmSideMenuToggleListBlockIcon,
  NfmSideMenuTurnIntoIcon,
} from "@/components/shared/icons";
import {
  NodexPopover,
  NodexPopoverAnchor,
  NodexPopoverContent,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  buildNfmSideMenuSections,
  filterNfmSideMenuSections,
  flattenNfmSideMenuRows,
  getInitialNfmSideMenuFocusIndex,
  moveNfmSideMenuFocus,
  shouldRenderNfmSideMenuSeparatorBefore,
  type NfmSideMenuAction,
  type NfmSideMenuActionKey,
  type NfmSideMenuFlatRow,
  type NfmSideMenuSection,
  type NfmSideMenuSubmenuKey,
  type SendBlocksMode,
} from "./nfm-side-menu-model";
import {
  computeNfmSideMenuPosition,
  NFM_SIDE_MENU_WIDTH,
  type NfmSideMenuPosition,
  type NfmSideMenuRect,
} from "./nfm-side-menu-position";
import { useNfmSideMenuRuntime } from "./nfm-side-menu-runtime";
import {
  applySideMenuSelectionIntent,
  createSideMenuSelectionIntent,
  type SideMenuSelectionEditor,
  type SideMenuSelectionIntent,
} from "./nfm-side-menu-selection";
import { createSideMenuFreezeController } from "./side-menu-freeze-controller";
import { resolveCardRefOwnerDragBlock } from "./side-menu-drag-target";

interface SideMenuBlock {
  id?: string;
  type?: string;
  props?: Record<string, unknown>;
  content?: unknown;
  children?: SideMenuBlock[];
}

interface SideMenuEditorRuntime extends SideMenuSelectionEditor {
  isEditable?: boolean;
  getBlock?: (blockId: string) => unknown;
  getParentBlock?: (blockId: string) => unknown;
  getSelection?: () => { blocks?: SideMenuBlock[] } | undefined;
  getTextCursorPosition?: () => { block?: SideMenuBlock };
  setTextCursorPosition?: (block: SideMenuBlock) => void;
  insertBlocks?: (blocks: unknown[], referenceBlock: unknown, placement: "before" | "after" | "nested") => unknown[];
  removeBlocks?: (blocks: unknown[]) => void;
  updateBlock?: (block: unknown, update: unknown) => void;
  focus?: () => void;
  settings?: {
    tables?: {
      headers?: boolean;
    };
  };
  prosemirrorView?: SideMenuSelectionEditor["prosemirrorView"] & {
    dom?: HTMLElement;
    editable?: boolean;
  };
  schema: {
    blockSpecs: Record<string, { implementation: { meta?: { fileBlockAccept?: boolean } } }>;
  };
}

interface SideMenuButtonProps {
  label: string;
  className?: string;
  icon?: ReactNode;
  onClick?: () => void;
  onPointerDown?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerMove?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerUp?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onDragStart?: (event: { dataTransfer: DataTransfer | null; clientY: number }) => void;
  onDragEnd?: () => void;
  draggable?: boolean;
}

interface NfmSideMenuOpenState {
  block: SideMenuBlock;
  anchorRect: NfmSideMenuRect;
  returnFocusElement: HTMLElement | null;
  selectionIntent: SideMenuSelectionIntent;
}

interface NfmSideMenuColorOption {
  color: NfmSideMenuColorValue;
  label: string;
}

interface NfmSideMenuTurnIntoItem {
  key: string;
  label: string;
  type: string;
  props?: Record<string, boolean | number | string>;
  enabled: boolean;
}

type NfmSideMenuColorValue =
  | "default"
  | "gray"
  | "brown"
  | "red"
  | "orange"
  | "yellow"
  | "green"
  | "blue"
  | "purple"
  | "pink";

interface NfmSideMenuSurfaceProps {
  sections: NfmSideMenuSection[];
  query: string;
  focusedIndex: number;
  activeSubmenu: NfmSideMenuSubmenuKey | null;
  listboxId: string;
  comboboxId: string;
  activeDescendantId: string | undefined;
  turnIntoItems: NfmSideMenuTurnIntoItem[];
  colorOptions: NfmSideMenuColorOption[];
  canUseTextColor: boolean;
  canUseBackgroundColor: boolean;
  canSendBlocks: boolean;
  textColor: string;
  backgroundColor: string;
  footerPrimary: string;
  footerSecondary: string;
  onQueryChange: (query: string) => void;
  onFocusIndexChange: (index: number) => void;
  onMoveFocus: (direction: 1 | -1) => void;
  onActivateFocused: () => void;
  onClose: () => void;
  onAction: (row: NfmSideMenuAction) => void;
  onSubmenuChange: (submenu: NfmSideMenuSubmenuKey | null) => void;
  onTurnInto: (item: NfmSideMenuTurnIntoItem) => void;
  onColor: (kind: "text" | "background", color: NfmSideMenuColorValue) => void;
  onSendBlocks: (mode: SendBlocksMode) => void;
}

const SIDE_MENU_CLICK_TOLERANCE = 4;
const SIDE_MENU_SHORTCUT_KEY = "/";
const SIDE_MENU_SUBMENU_SELECTOR = "[data-nfm-side-menu-submenu='true']";
const SIDE_MENU_COLOR_VALUES = [
  "default",
  "gray",
  "brown",
  "red",
  "orange",
  "yellow",
  "green",
  "blue",
  "purple",
  "pink",
] as const satisfies readonly NfmSideMenuColorValue[];

const SIDE_MENU_COLOR_LABELS = {
  default: "Default",
  gray: "Gray",
  brown: "Brown",
  red: "Red",
  orange: "Orange",
  yellow: "Yellow",
  green: "Green",
  blue: "Blue",
  purple: "Purple",
  pink: "Pink",
} as const satisfies Record<NfmSideMenuColorValue, string>;

const SIDE_MENU_COLOR_STYLES = {
  default: "transparent",
  gray: "color-mix(in srgb, var(--color-token-foreground) 42%, transparent)",
  brown: "color-mix(in srgb, var(--color-token-charts-orange) 70%, var(--color-token-foreground) 18%)",
  orange: "var(--color-token-charts-orange)",
  yellow: "var(--color-token-charts-yellow)",
  green: "var(--color-token-charts-green)",
  blue: "var(--color-token-charts-blue)",
  purple: "var(--color-token-charts-purple)",
  pink: "color-mix(in srgb, var(--color-token-charts-purple) 56%, var(--color-token-charts-red) 44%)",
  red: "var(--color-token-charts-red)",
} as const satisfies Record<NfmSideMenuColorValue, string>;

const SIDE_MENU_BACKGROUND_COLOR_STYLES = {
  default: "transparent",
  gray: "color-mix(in srgb, var(--color-token-foreground) 12%, transparent)",
  brown: "color-mix(in srgb, var(--color-token-charts-orange) 24%, transparent)",
  orange: "color-mix(in srgb, var(--color-token-charts-orange) 24%, transparent)",
  yellow: "color-mix(in srgb, var(--color-token-charts-yellow) 30%, transparent)",
  green: "color-mix(in srgb, var(--color-token-charts-green) 24%, transparent)",
  blue: "color-mix(in srgb, var(--color-token-charts-blue) 22%, transparent)",
  purple: "color-mix(in srgb, var(--color-token-charts-purple) 24%, transparent)",
  pink: "color-mix(in srgb, var(--color-token-charts-purple) 18%, var(--color-token-charts-red) 14%)",
  red: "color-mix(in srgb, var(--color-token-charts-red) 24%, transparent)",
} as const satisfies Record<NfmSideMenuColorValue, string>;

const SIDE_MENU_TURN_INTO_DEFINITIONS = [
  { key: "paragraph", label: "Text", type: "paragraph" },
  { key: "heading-1", label: "Heading 1", type: "heading", props: { level: 1, isToggleable: false } },
  { key: "heading-2", label: "Heading 2", type: "heading", props: { level: 2, isToggleable: false } },
  { key: "heading-3", label: "Heading 3", type: "heading", props: { level: 3, isToggleable: false } },
  { key: "bullet-list", label: "Bulleted list", type: "bulletListItem" },
  { key: "numbered-list", label: "Numbered list", type: "numberedListItem" },
  { key: "todo-list", label: "To-do list", type: "checkListItem" },
  { key: "toggle-list", label: "Toggle list", type: "toggleListItem" },
  { key: "quote", label: "Quote", type: "quote" },
  { key: "code", label: "Code", type: "codeBlock" },
] as const;

function toStringProp(props: Record<string, unknown> | undefined, key: string): string {
  const value = props?.[key];
  return typeof value === "string" ? value : "";
}

function toNumberProp(props: Record<string, unknown> | undefined, key: string): number | null {
  const value = props?.[key];
  return typeof value === "number" ? value : null;
}

function normalizeColorValue(value: unknown): NfmSideMenuColorValue {
  return SIDE_MENU_COLOR_VALUES.includes(value as NfmSideMenuColorValue)
    ? value as NfmSideMenuColorValue
    : "default";
}

function propsToSchemaShape(props?: Record<string, boolean | number | string>) {
  return Object.fromEntries(
    Object.entries(props ?? {}).map(([key, value]) => [key, typeof value]),
  ) as Record<string, "boolean" | "number" | "string">;
}

function getSideMenuActionBlocks(openState: NfmSideMenuOpenState, fallbackBlock: SideMenuBlock) {
  return openState.selectionIntent.blocks.length > 0
    ? openState.selectionIntent.blocks as SideMenuBlock[]
    : [fallbackBlock];
}

function getTopLevelSideMenuActionBlocks(blocks: SideMenuBlock[]) {
  const selectedDescendantIds = new Set<string>();

  const addDescendantIds = (children: SideMenuBlock[] | undefined) => {
    for (const childBlock of children ?? []) {
      const childBlockId = getCurrentBlockId(childBlock);
      if (childBlockId) selectedDescendantIds.add(childBlockId);
      addDescendantIds(childBlock.children);
    }
  };

  for (const block of blocks) {
    addDescendantIds(block.children);
  }

  return blocks.filter((block) => {
    const blockId = getCurrentBlockId(block);
    return !blockId || !selectedDescendantIds.has(blockId);
  });
}

function cloneBlockForInsert(block: SideMenuBlock): Record<string, unknown> {
  const rest = { ...block } as Record<string, unknown>;
  delete rest.id;
  delete rest.children;
  return {
    ...rest,
    ...(block.children ? { children: block.children.map(cloneBlockForInsert) } : {}),
  };
}

function getCurrentBlockId(block: SideMenuBlock) {
  return typeof block.id === "string" && block.id.length > 0 ? block.id : null;
}

function getEditorEditable(editor: SideMenuEditorRuntime) {
  if (editor.isEditable === false) return false;
  if (editor.prosemirrorView?.editable === false) return false;
  return true;
}

function supportsBlockColor(
  editor: SideMenuEditorRuntime,
  block: SideMenuBlock,
) {
  if (!block.type) {
    return {
      text: false,
      background: false,
    };
  }

  const text = blockHasType(
    block as Parameters<typeof blockHasType>[0],
    editor as Parameters<typeof blockHasType>[1],
    block.type,
    { textColor: "string" },
  ) && editorHasBlockWithType(
    editor as Parameters<typeof editorHasBlockWithType>[0],
    block.type,
    { textColor: "string" },
  );
  const background = blockHasType(
    block as Parameters<typeof blockHasType>[0],
    editor as Parameters<typeof blockHasType>[1],
    block.type,
    { backgroundColor: "string" },
  ) && editorHasBlockWithType(
    editor as Parameters<typeof editorHasBlockWithType>[0],
    block.type,
    { backgroundColor: "string" },
  );

  return { text, background };
}

function getTurnIntoItems(editor: SideMenuEditorRuntime): NfmSideMenuTurnIntoItem[] {
  return SIDE_MENU_TURN_INTO_DEFINITIONS.map((item) => {
    const props = "props" in item ? item.props : undefined;
    return {
      key: item.key,
      label: item.label,
      type: item.type,
      props,
      enabled: editorHasBlockWithType(
        editor as Parameters<typeof editorHasBlockWithType>[0],
        item.type,
        propsToSchemaShape(props),
      ),
    };
  });
}

function getBlockTypeIcon(item: NfmSideMenuTurnIntoItem) {
  if (item.key === "heading-1") return <NfmSideMenuHeadingBlockIcon level={1} />;
  if (item.key === "heading-2") return <NfmSideMenuHeadingBlockIcon level={2} />;
  if (item.key === "heading-3") return <NfmSideMenuHeadingBlockIcon level={3} />;
  if (item.key === "bullet-list") return <NfmSideMenuBulletedListBlockIcon />;
  if (item.key === "numbered-list") return <NfmSideMenuNumberedListBlockIcon />;
  if (item.key === "todo-list") return <NfmSideMenuCheckListBlockIcon />;
  if (item.key === "toggle-list") return <NfmSideMenuToggleListBlockIcon />;
  if (item.key === "quote") return <NfmSideMenuQuoteBlockIcon />;
  if (item.key === "code") return <NfmSideMenuCodeBlockIcon />;
  return <NfmSideMenuTextBlockIcon />;
}

function getActionIcon(key: NfmSideMenuActionKey) {
  if (key === "turn-into") return <NfmSideMenuTurnIntoIcon />;
  if (key === "color") return <NfmSideMenuColorIcon />;
  if (key === "copy-link-to-block") return <NfmSideMenuCopyLinkIcon />;
  if (key === "duplicate") return <NfmSideMenuDuplicateIcon />;
  if (key === "move-to") return <NfmSideMenuMoveToIcon />;
  if (key === "delete") return <NfmSideMenuDeleteIcon />;
  if (key === "comment") return <NfmSideMenuCommentIcon />;
  if (key === "suggest-edits") return <NfmSideMenuSuggestEditsIcon />;
  if (key === "present-from-here") return <NfmSideMenuPlayIcon />;
  if (key === "ask-ai") return <NfmSideMenuAiFaceIcon />;
  if (key === "convert-divider-to-thread-section") return <CodeBracketsIcon className="size-5" />;
  return <NfmSideMenuTableHeaderIcon />;
}

function getOptionId(listboxId: string, index: number) {
  return `${listboxId}-option-${index}`;
}

function keepEditorSelection(event: ReactPointerEvent<HTMLElement>) {
  if (event.button !== 0) return;
  event.preventDefault();
}

function getClosestElement(target: EventTarget | null): Element | null {
  if (target instanceof Element) return target;
  if (!(target instanceof Node)) return null;
  return target.parentElement;
}

function NfmAddBlockButton() {
  const Components = useComponentsContext()!;
  const dict = useDictionary();
  const editor = useBlockNoteEditor();
  const suggestionMenu = useExtension(SuggestionMenu);
  const SideMenuButton = Components.SideMenu.Button as unknown as (props: SideMenuButtonProps) => ReactNode;
  type CursorTarget = Parameters<typeof editor.setTextCursorPosition>[0];
  const lastPointerActivationAtRef = useRef<number | null>(null);
  const block = useExtensionState(SideMenuExtension, {
    editor,
    selector: (state) => state?.block,
  }) as (CursorTarget & { content?: unknown[] }) | undefined;

  const activateAddBlock = useCallback(() => {
    if (!block) return;

    const blockContent = Array.isArray(block.content) ? block.content : [];
    if (blockContent.length === 0) {
      editor.setTextCursorPosition(block);
      suggestionMenu.openSuggestionMenu("/");
      return;
    }

    const insertedBlock = editor.insertBlocks([{ type: "paragraph" }], block, "after")[0];
    if (!insertedBlock) return;

    editor.setTextCursorPosition(insertedBlock);
    suggestionMenu.openSuggestionMenu("/");
  }, [block, editor, suggestionMenu]);

  const handlePointerUp = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.pointerType !== "mouse" || event.button !== 0) return;

    lastPointerActivationAtRef.current = performance.now();
    activateAddBlock();
  }, [activateAddBlock]);

  const handleClick = useCallback(() => {
    const lastPointerActivationAt = lastPointerActivationAtRef.current;
    if (lastPointerActivationAt !== null && performance.now() - lastPointerActivationAt < 500) {
      lastPointerActivationAtRef.current = null;
      return;
    }

    activateAddBlock();
  }, [activateAddBlock]);

  if (!block) return null;

  return (
    <SideMenuButton
      className="bn-button"
      label={dict.side_menu.add_block_label}
      onClick={handleClick}
      onPointerUp={handlePointerUp}
      icon={
        <span className="pointer-events-none" data-test="dragHandleAdd">
          <Plus size={18} />
        </span>
      }
    />
  );
}

function NfmSideMenuRow({
  row,
  index,
  listboxId,
  focused,
  activeSubmenu,
  onAction,
  onFocusIndexChange,
  onSubmenuChange,
  submenuContent,
}: {
  row: NfmSideMenuAction;
  index: number;
  listboxId: string;
  focused: boolean;
  activeSubmenu: NfmSideMenuSubmenuKey | null;
  onAction: (row: NfmSideMenuAction) => void;
  onFocusIndexChange: (index: number) => void;
  onSubmenuChange: (submenu: NfmSideMenuSubmenuKey | null) => void;
  submenuContent?: ReactNode;
}) {
  const rowElement = (
    <div
      id={getOptionId(listboxId, index)}
      role="option"
      aria-selected={focused}
      aria-disabled={!row.enabled || undefined}
      aria-haspopup={row.kind === "submenu" ? "dialog" : undefined}
      aria-expanded={row.kind === "submenu" ? activeSubmenu === row.submenu : undefined}
      data-focused={focused ? "true" : undefined}
      data-disabled={!row.enabled ? "true" : undefined}
      className={cn(
        "group flex h-7 select-none items-center gap-2 rounded-[7px] px-2 text-[14px] leading-7 outline-hidden",
        "text-token-foreground",
        row.enabled ? "cursor-interaction" : "cursor-default opacity-45",
        focused && "bg-token-list-hover-background",
      )}
      onPointerDown={keepEditorSelection}
      onPointerEnter={() => {
        onFocusIndexChange(index);
        if (row.kind === "submenu" && row.submenu && row.enabled) {
          onSubmenuChange(row.submenu);
          return;
        }
        onSubmenuChange(null);
      }}
      onClick={(event) => {
        event.stopPropagation();
        if (!row.enabled) return;
        if (row.kind === "submenu" && row.submenu) {
          onSubmenuChange(row.submenu);
        }
        onAction(row);
      }}
    >
      <span className="flex size-5 shrink-0 items-center justify-center text-token-description-foreground">
        {getActionIcon(row.key)}
      </span>
      <span className="min-w-0 flex-1 truncate text-left">{row.label}</span>
      {row.badge ? (
        <span className="shrink-0 rounded-[4px] bg-token-foreground/5 px-1 text-[11px] leading-4 text-token-description-foreground">
          {row.badge}
        </span>
      ) : null}
      {row.shortcut ? (
        <span className="shrink-0 text-[12px] leading-4 text-token-description-foreground">
          {row.shortcut}
        </span>
      ) : null}
      {row.kind === "submenu" ? (
        <NfmSideMenuChevronRightIcon className="text-token-description-foreground" />
      ) : null}
    </div>
  );

  if (row.kind !== "submenu" || !row.submenu || !submenuContent) return rowElement;

  return (
    <NodexPopover
      open={activeSubmenu === row.submenu}
      onOpenChange={(open) => {
        if (open) {
          onSubmenuChange(row.submenu ?? null);
          return;
        }
        if (activeSubmenu === row.submenu) {
          onSubmenuChange(null);
        }
      }}
    >
      <NodexPopoverAnchor asChild>
        {rowElement}
      </NodexPopoverAnchor>
      <NodexPopoverContent
        side="right"
        align="start"
        sideOffset={6}
        alignOffset={-4}
        aria-label={row.label}
        data-nfm-side-menu-submenu="true"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        className="w-[226px] overflow-y-auto p-1 text-[14px] leading-[1.2] shadow-xl-spread backdrop-blur-xl"
        style={{ width: 226 }}
      >
        {submenuContent}
      </NodexPopoverContent>
    </NodexPopover>
  );
}

function NfmSideMenuSeparator({
  kind,
}: {
  kind: "group" | "footer";
}) {
  return (
    <div
      aria-hidden="true"
      data-nfm-side-menu-separator={kind}
      className={cn("w-full px-2 pb-1", kind === "group" ? "pt-1" : "pt-0")}
    >
      <div className="h-px w-full bg-token-menu-border" />
    </div>
  );
}

function NfmSideMenuSectionView({
  section,
  startIndex,
  previousRow,
  focusedIndex,
  activeSubmenu,
  listboxId,
  onAction,
  onFocusIndexChange,
  onSubmenuChange,
  renderSubmenu,
}: {
  section: NfmSideMenuSection;
  startIndex: number;
  previousRow: NfmSideMenuFlatRow | undefined;
  focusedIndex: number;
  activeSubmenu: NfmSideMenuSubmenuKey | null;
  listboxId: string;
  onAction: (row: NfmSideMenuAction) => void;
  onFocusIndexChange: (index: number) => void;
  onSubmenuChange: (submenu: NfmSideMenuSubmenuKey | null) => void;
  renderSubmenu: (submenu: NfmSideMenuSubmenuKey) => ReactNode;
}) {
  return (
    <div className="py-1">
      <div className="flex h-6 items-center px-2 text-[12px] leading-6 text-token-description-foreground">
        <span className="min-w-0 flex-1 truncate">{section.label}</span>
      </div>
      <div className="flex flex-col gap-px">
        {section.rows.map((row, offset) => {
          const index = startIndex + offset;
          const currentFlatRow = { sectionKey: section.key, row };
          const previousFlatRow = offset === 0
            ? previousRow
            : { sectionKey: section.key, row: section.rows[offset - 1]! };
          return (
            <Fragment key={row.key}>
              {shouldRenderNfmSideMenuSeparatorBefore(previousFlatRow, currentFlatRow) ? (
                <NfmSideMenuSeparator kind="group" />
              ) : null}
              <NfmSideMenuRow
                row={row}
                index={index}
                listboxId={listboxId}
                focused={focusedIndex === index}
                activeSubmenu={activeSubmenu}
                onAction={onAction}
                onFocusIndexChange={onFocusIndexChange}
                onSubmenuChange={onSubmenuChange}
                submenuContent={row.submenu ? renderSubmenu(row.submenu) : undefined}
              />
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

function NfmSideMenuSubmenuRow({
  children,
  disabled = false,
  selected = false,
  onClick,
  leftSlot,
  rightSlot,
}: {
  children: ReactNode;
  disabled?: boolean;
  selected?: boolean;
  onClick?: () => void;
  leftSlot?: ReactNode;
  rightSlot?: ReactNode;
}) {
  return (
    <div
      role="menuitem"
      tabIndex={-1}
      aria-disabled={disabled || undefined}
      aria-current={selected ? "true" : undefined}
      className={cn(
        "flex h-7 select-none items-center gap-2 rounded-[7px] px-2 text-[14px] leading-7 outline-hidden",
        disabled
          ? "cursor-default text-token-text-secondary opacity-45"
          : "cursor-interaction text-token-foreground hover:bg-token-list-hover-background",
      )}
      onPointerDown={keepEditorSelection}
      onClick={(event) => {
        event.stopPropagation();
        if (disabled) return;
        onClick?.();
      }}
    >
      <span className="flex size-5 shrink-0 items-center justify-center text-token-description-foreground">
        {leftSlot}
      </span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {selected ? <CheckmarkIcon className="size-4 shrink-0" /> : rightSlot}
    </div>
  );
}

function NfmSideMenuColorDot({
  color,
  kind,
  selected,
}: {
  color: NfmSideMenuColorValue;
  kind: "text" | "background";
  selected: boolean;
}) {
  const style: CSSProperties = kind === "text"
    ? {
        color: color === "default" ? "var(--color-token-foreground)" : SIDE_MENU_COLOR_STYLES[color],
        backgroundColor: "transparent",
        boxShadow: `inset 0 0 0 ${selected ? 2 : 1}px ${color === "default" ? "var(--color-token-border)" : SIDE_MENU_COLOR_STYLES[color]}`,
      }
    : {
        color: "var(--color-token-foreground)",
        backgroundColor: SIDE_MENU_BACKGROUND_COLOR_STYLES[color],
        boxShadow: `inset 0 0 0 ${selected ? 2 : 1}px ${color === "default" ? "var(--color-token-border)" : SIDE_MENU_COLOR_STYLES[color]}`,
      };

  return (
    <span
      className="inline-flex size-5 shrink-0 items-center justify-center rounded-[6px] text-[12px] leading-none font-medium"
      style={style}
      aria-hidden="true"
    >
      {kind === "text" ? "A" : null}
    </span>
  );
}

function NfmSideMenuSubmenu({
  submenu,
  turnIntoItems,
  colorOptions,
  canUseTextColor,
  canUseBackgroundColor,
  canSendBlocks,
  textColor,
  backgroundColor,
  onTurnInto,
  onColor,
  onSendBlocks,
}: Pick<
  NfmSideMenuSurfaceProps,
  | "turnIntoItems"
  | "colorOptions"
  | "canUseTextColor"
  | "canUseBackgroundColor"
  | "canSendBlocks"
  | "textColor"
  | "backgroundColor"
  | "onTurnInto"
  | "onColor"
  | "onSendBlocks"
> & {
  submenu: NfmSideMenuSubmenuKey;
}) {
  return (
    <>
      {submenu === "turn-into" ? (
        <div role="menu" aria-label="Turn into">
          <div className="flex h-6 items-center px-2 text-[12px] text-token-description-foreground">Turn into</div>
          {turnIntoItems.map((item) => (
            <NfmSideMenuSubmenuRow
              key={item.key}
              disabled={!item.enabled}
              leftSlot={getBlockTypeIcon(item)}
              onClick={() => onTurnInto(item)}
            >
              {item.label}
            </NfmSideMenuSubmenuRow>
          ))}
          <div className="mx-2 my-1 h-px bg-token-menu-border" />
          <NfmSideMenuSubmenuRow
            leftSlot={<NfmSideMenuPageInIcon />}
            disabled={!canSendBlocks}
            onClick={() => onSendBlocks("project")}
          >
            Card in
          </NfmSideMenuSubmenuRow>
        </div>
      ) : null}
      {submenu === "color" ? (
        <div role="menu" aria-label="Color">
          {canUseTextColor ? (
            <>
              <div className="flex h-6 items-center px-2 text-[12px] text-token-description-foreground">Text color</div>
              {colorOptions.map((option) => (
                <NfmSideMenuSubmenuRow
                  key={`text-${option.color}`}
                  selected={normalizeColorValue(textColor) === option.color}
                  leftSlot={(
                    <NfmSideMenuColorDot
                      kind="text"
                      color={option.color}
                      selected={normalizeColorValue(textColor) === option.color}
                    />
                  )}
                  onClick={() => onColor("text", option.color)}
                >
                  {option.label}
                </NfmSideMenuSubmenuRow>
              ))}
            </>
          ) : null}
          {canUseBackgroundColor ? (
            <>
              <div className="mx-2 my-1 h-px bg-token-menu-border" />
              <div className="flex h-6 items-center px-2 text-[12px] text-token-description-foreground">Background color</div>
              {colorOptions.map((option) => (
                <NfmSideMenuSubmenuRow
                  key={`background-${option.color}`}
                  selected={normalizeColorValue(backgroundColor) === option.color}
                  leftSlot={(
                    <NfmSideMenuColorDot
                      kind="background"
                      color={option.color}
                      selected={normalizeColorValue(backgroundColor) === option.color}
                    />
                  )}
                  onClick={() => onColor("background", option.color)}
                >
                  {option.label}
                </NfmSideMenuSubmenuRow>
              ))}
            </>
          ) : null}
        </div>
      ) : null}
      {submenu === "move-to" ? (
        <div role="menu" aria-label="Move to">
          <div className="flex h-6 items-center px-2 text-[12px] text-token-description-foreground">Move to</div>
          <NfmSideMenuSubmenuRow
            leftSlot={<NfmSideMenuSendBlocksIcon />}
            disabled={!canSendBlocks}
            onClick={() => onSendBlocks("card")}
          >
            Move to card
          </NfmSideMenuSubmenuRow>
          <NfmSideMenuSubmenuRow
            leftSlot={<NfmSideMenuSendBlocksIcon />}
            disabled={!canSendBlocks}
            onClick={() => onSendBlocks("project")}
          >
            Move to DB
          </NfmSideMenuSubmenuRow>
        </div>
      ) : null}
    </>
  );
}

export function NfmSideMenuSurface({
  sections,
  query,
  focusedIndex,
  activeSubmenu,
  listboxId,
  comboboxId,
  activeDescendantId,
  turnIntoItems,
  colorOptions,
  canUseTextColor,
  canUseBackgroundColor,
  canSendBlocks,
  textColor,
  backgroundColor,
  footerPrimary,
  footerSecondary,
  onQueryChange,
  onFocusIndexChange,
  onMoveFocus,
  onActivateFocused,
  onClose,
  onAction,
  onSubmenuChange,
  onTurnInto,
  onColor,
  onSendBlocks,
}: NfmSideMenuSurfaceProps) {
  let rowIndex = 0;
  const flatRowsForSeparators = useMemo(() => flattenNfmSideMenuRows(sections), [sections]);

  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      onMoveFocus(1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      onMoveFocus(-1);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      onActivateFocused();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  };
  const renderSubmenu = (submenu: NfmSideMenuSubmenuKey) => (
    <NfmSideMenuSubmenu
      submenu={submenu}
      turnIntoItems={turnIntoItems}
      colorOptions={colorOptions}
      canUseTextColor={canUseTextColor}
      canUseBackgroundColor={canUseBackgroundColor}
      canSendBlocks={canSendBlocks}
      textColor={textColor}
      backgroundColor={backgroundColor}
      onTurnInto={onTurnInto}
      onColor={onColor}
      onSendBlocks={onSendBlocks}
    />
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Block actions"
      className="relative w-[265px] min-w-[180px] max-w-[calc(100vw-24px)] overflow-hidden rounded-xl bg-token-dropdown-background/90 p-0 text-[14px] leading-[1.2] text-token-foreground shadow-xl-spread ring-[0.5px] ring-token-border backdrop-blur-xl"
    >
      <div className="flex max-h-[70vh] flex-col overflow-hidden">
        <div className="p-1.5 pb-1">
          <input
            id={comboboxId}
            role="combobox"
            aria-autocomplete="list"
            aria-controls={listboxId}
            aria-expanded={activeSubmenu !== null}
            aria-haspopup="listbox"
            aria-activedescendant={activeDescendantId}
            value={query}
            placeholder="Search actions…"
            className="h-7 w-full rounded-[7px] bg-token-foreground/5 px-2 text-[14px] text-token-foreground outline-hidden placeholder:text-token-description-foreground focus:bg-token-foreground/10"
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={handleInputKeyDown}
          />
        </div>
        <div className="notion-scroller vertical min-h-0 flex-1 overflow-y-auto px-1">
          <div id={listboxId} role="listbox" aria-labelledby={comboboxId}>
            {sections.length === 0 ? (
              <div className="flex h-10 items-center px-2 text-[13px] text-token-description-foreground">
                No results
              </div>
            ) : null}
            {sections.map((section) => {
              const startIndex = rowIndex;
              rowIndex += section.rows.length;
              return (
                <NfmSideMenuSectionView
                  key={section.key}
                  section={section}
                  startIndex={startIndex}
                  previousRow={flatRowsForSeparators[startIndex - 1]}
                  focusedIndex={focusedIndex}
                  activeSubmenu={activeSubmenu}
                  listboxId={listboxId}
                  onAction={(row) => {
                    if (row.kind === "submenu" && row.submenu) {
                      onSubmenuChange(row.submenu);
                    }
                    onAction(row);
                  }}
                  onFocusIndexChange={onFocusIndexChange}
                  onSubmenuChange={onSubmenuChange}
                  renderSubmenu={renderSubmenu}
                />
              );
            })}
          </div>
        </div>
        <div className="px-1 pb-1 text-[12px] leading-4 text-token-description-foreground">
          <NfmSideMenuSeparator kind="footer" />
          <div className="px-2 py-1.5">
            <div className="truncate">{footerPrimary}</div>
            <div className="truncate">{footerSecondary}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function NfmSideMenuPopup({
  openState,
  editor,
  releaseSideMenuFreeze,
  onClose,
}: {
  openState: NfmSideMenuOpenState | null;
  editor: SideMenuEditorRuntime;
  releaseSideMenuFreeze?: () => void;
  onClose: () => void;
}) {
  const runtime = useNfmSideMenuRuntime();
  const formattingToolbar = useExtension(FormattingToolbarExtension, {
    editor: editor as never,
  });
  const { showSelection } = useExtension(ShowSelectionExtension);
  const listboxId = useId();
  const comboboxId = useId();
  const popupRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [activeSubmenu, setActiveSubmenu] = useState<NfmSideMenuSubmenuKey | null>(null);
  const [position, setPosition] = useState<NfmSideMenuPosition | null>(null);

  const block = openState?.block;
  const currentBlockId = block ? getCurrentBlockId(block) : null;
  const colorSupport = block ? supportsBlockColor(editor, block) : { text: false, background: false };
  const runtimeSnapshot = runtime.getSnapshot();
  const isEditable = getEditorEditable(editor);
  const baseSections = useMemo(() => buildNfmSideMenuSections({
    currentBlockId,
    currentBlockType: block?.type ?? null,
    isEditable,
    canUseColor: colorSupport.text || colorSupport.background,
    canSendBlocks: runtimeSnapshot.canSendBlocks,
    hasConvertDividerToThreadSection: runtimeSnapshot.hasConvertDividerToThreadSection,
    isTableBlock: block?.type === "table",
    canUseTableHeaders: editor.settings?.tables?.headers === true,
  }), [
    block?.type,
    colorSupport.background,
    colorSupport.text,
    currentBlockId,
    editor.settings?.tables?.headers,
    runtimeSnapshot.hasConvertDividerToThreadSection,
    isEditable,
    runtimeSnapshot.canSendBlocks,
  ]);
  const sections = useMemo(
    () => filterNfmSideMenuSections(baseSections, query),
    [baseSections, query],
  );
  const flatRows = useMemo(() => flattenNfmSideMenuRows(sections), [sections]);
  const turnIntoItems = useMemo(() => getTurnIntoItems(editor), [editor]);
  const colorOptions = useMemo(() => SIDE_MENU_COLOR_VALUES.map((color) => ({
    color,
    label: SIDE_MENU_COLOR_LABELS[color],
  })), []);
  const activeDescendantId = focusedIndex >= 0 && focusedIndex < flatRows.length
    ? getOptionId(listboxId, focusedIndex)
    : undefined;

  const close = useCallback(() => {
    setQuery("");
    setFocusedIndex(-1);
    setActiveSubmenu(null);
    releaseSideMenuFreeze?.();
    onClose();
    requestAnimationFrame(() => {
      openState?.returnFocusElement?.focus?.();
    });
  }, [onClose, openState?.returnFocusElement, releaseSideMenuFreeze]);

  useEffect(() => {
    if (!openState) return;
    formattingToolbar.store.setState(false);
    showSelection(true, "nfmSideMenu");
    return () => showSelection(false, "nfmSideMenu");
  }, [formattingToolbar.store, openState, showSelection]);

  const executeAction = useCallback((key: NfmSideMenuActionKey) => {
    if (!block || !currentBlockId || !openState) return;
    if (!isEditable) return;

    const selectedBlocks = getSideMenuActionBlocks(openState, block);
    const topLevelSelectedBlocks = getTopLevelSideMenuActionBlocks(selectedBlocks);

    if (key === "duplicate") {
      const referenceBlock = topLevelSelectedBlocks[topLevelSelectedBlocks.length - 1] ?? block;
      editor.insertBlocks?.(topLevelSelectedBlocks.map(cloneBlockForInsert), referenceBlock, "after");
      close();
      return;
    }

    if (key === "delete") {
      editor.removeBlocks?.(topLevelSelectedBlocks);
      close();
      return;
    }

    if (key === "convert-divider-to-thread-section") {
      runtimeSnapshot.onConvertDividerToThreadSection(currentBlockId);
      close();
      return;
    }

    if (key === "table-header-row" || key === "table-header-column") {
      if (block.type !== "table") return;
      const tableContent = typeof block.content === "object" && block.content !== null
        ? block.content as { headerRows?: number; headerCols?: number }
        : {};
      editor.updateBlock?.(block, {
        content: {
          ...tableContent,
          ...(key === "table-header-row"
            ? { headerRows: tableContent.headerRows ? undefined : 1 }
            : { headerCols: tableContent.headerCols ? undefined : 1 }),
        },
      });
      close();
    }
  }, [block, close, currentBlockId, editor, isEditable, openState, runtimeSnapshot]);

  const activateRow = useCallback((row: NfmSideMenuAction) => {
    if (!row.enabled) return;
    if (row.kind === "submenu" && row.submenu) {
      setActiveSubmenu(row.submenu);
      return;
    }
    executeAction(row.key);
  }, [executeAction]);

  const activateFocusedRow = useCallback(() => {
    const focusedRow = flatRows[focusedIndex]?.row;
    if (!focusedRow) return;
    activateRow(focusedRow);
  }, [activateRow, flatRows, focusedIndex]);

  useEffect(() => {
    setFocusedIndex(getInitialNfmSideMenuFocusIndex(query, flatRows));
    setActiveSubmenu(null);
  }, [flatRows, query]);

  useLayoutEffect(() => {
    if (!openState) return;

    const updatePosition = () => {
      setPosition(computeNfmSideMenuPosition({
        anchorRect: openState.anchorRect,
        menuHeight: popupRef.current?.getBoundingClientRect().height,
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight,
        },
      }));
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [openState]);

  useEffect(() => {
    if (!openState) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (getClosestElement(target)?.closest(SIDE_MENU_SUBMENU_SELECTOR)) return;
      if (popupRef.current?.contains(target)) return;
      if (openState.returnFocusElement?.contains(target)) return;
      close();
    };
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      close();
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [close, openState]);

  useEffect(() => {
    if (!openState) return;
    requestAnimationFrame(() => {
      popupRef.current?.querySelector<HTMLInputElement>("input[role='combobox']")?.focus();
    });
  }, [openState]);

  if (!openState || !block || !position) return null;

  return createPortal(
    <div
      ref={popupRef}
      className="fixed z-50 origin-[var(--nfm-side-menu-origin)] opacity-100 transition-[opacity,transform] duration-200 ease-[ease] motion-reduce:transition-none"
      style={{
        left: position.left,
        top: position.top,
        width: NFM_SIDE_MENU_WIDTH,
        maxHeight: position.maxHeight,
        "--nfm-side-menu-origin": position.transformOrigin,
      } as CSSProperties}
      contentEditable={false}
      data-nfm-side-menu-popup="true"
    >
      <NfmSideMenuSurface
        sections={sections}
        query={query}
        focusedIndex={focusedIndex}
        activeSubmenu={activeSubmenu}
        listboxId={listboxId}
        comboboxId={comboboxId}
        activeDescendantId={activeDescendantId}
        turnIntoItems={turnIntoItems}
        colorOptions={colorOptions}
        canUseTextColor={colorSupport.text}
        canUseBackgroundColor={colorSupport.background}
        canSendBlocks={runtimeSnapshot.canSendBlocks}
        textColor={toStringProp(block.props, "textColor")}
        backgroundColor={toStringProp(block.props, "backgroundColor")}
        footerPrimary="Last edited locally"
        footerSecondary="Now"
        onQueryChange={setQuery}
        onFocusIndexChange={setFocusedIndex}
        onMoveFocus={(direction) => {
          setFocusedIndex((currentIndex) => moveNfmSideMenuFocus(currentIndex, direction, flatRows));
        }}
        onActivateFocused={activateFocusedRow}
        onClose={close}
        onAction={activateRow}
        onSubmenuChange={setActiveSubmenu}
        onTurnInto={(item) => {
          if (!item.enabled) return;
          const selectedBlocks = getSideMenuActionBlocks(openState, block);
          for (const selectedBlock of selectedBlocks) {
            editor.updateBlock?.(selectedBlock, {
              type: item.type,
              ...(item.props ? { props: item.props } : {}),
            });
          }
          close();
        }}
        onColor={(kind, color) => {
          const selectedBlocks = getSideMenuActionBlocks(openState, block);
          const propName = kind === "text" ? "textColor" : "backgroundColor";
          const currentValue = normalizeColorValue(block.props?.[propName]);
          const nextValue = currentValue === color ? "default" : color;
          for (const selectedBlock of selectedBlocks) {
            editor.updateBlock?.(selectedBlock, {
              props: { [propName]: nextValue },
            });
          }
          close();
        }}
        onSendBlocks={(mode) => {
          if (!currentBlockId) return;
          runtimeSnapshot.onSendBlocks(mode, currentBlockId);
          close();
        }}
      />
    </div>,
    document.body,
  );
}

function resolveShortcutAnchorRect(
  editor: SideMenuEditorRuntime,
  block: SideMenuBlock,
): NfmSideMenuRect | null {
  const blockId = getCurrentBlockId(block);
  const root = editor.prosemirrorView?.dom;
  const cssEscape = globalThis.CSS?.escape ?? ((value: string) => value.replace(/["\\]/g, "\\$&"));
  const blockElement = blockId && root
    ? root.querySelector<HTMLElement>(`.bn-block[data-id="${cssEscape(blockId)}"]`)
    : null;
  const rect = blockElement?.getBoundingClientRect() ?? root?.getBoundingClientRect();
  if (!rect) return null;

  return {
    left: rect.left - 8,
    top: rect.top,
    width: 18,
    height: Math.min(Math.max(rect.height, 24), 40),
  };
}

export function NfmSideMenuShortcutController() {
  const editor = useBlockNoteEditor() as unknown as SideMenuEditorRuntime;
  const [openState, setOpenState] = useState<NfmSideMenuOpenState | null>(null);

  const close = useCallback(() => {
    setOpenState(null);
    requestAnimationFrame(() => {
      editor.focus?.();
    });
  }, [editor]);

  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== SIDE_MENU_SHORTCUT_KEY) return;
      if (!event.metaKey && !event.ctrlKey) return;
      if (event.shiftKey || event.altKey) return;

      const editorRoot = editor.prosemirrorView?.dom;
      if (editorRoot && document.activeElement && !editorRoot.contains(document.activeElement)) {
        return;
      }

      const block = editor.getSelection?.()?.blocks?.[0] ?? editor.getTextCursorPosition?.().block;
      if (!block) return;
      const anchorRect = resolveShortcutAnchorRect(editor, block);
      if (!anchorRect) return;

      event.preventDefault();
      const selectionIntent = createSideMenuSelectionIntent(editor, block);
      applySideMenuSelectionIntent(editor, selectionIntent);
      setOpenState({
        block,
        anchorRect,
        returnFocusElement: editorRoot ?? null,
        selectionIntent,
      });
    };

    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [editor]);

  return (
    <NfmSideMenuPopup
      openState={openState}
      editor={editor}
      onClose={close}
    />
  );
}

export function NfmSideMenu() {
  const Components = useComponentsContext()!;
  const dict = useDictionary();
  const sideMenu = useExtension(SideMenuExtension);
  const editor = useBlockNoteEditor();
  const SideMenuButton = Components.SideMenu.Button as unknown as (props: SideMenuButtonProps) => ReactNode;
  const block = useExtensionState(SideMenuExtension, {
    selector: (state) => state?.block,
  }) as unknown as SideMenuBlock | undefined;
  const runtimeEditor = editor as unknown as SideMenuEditorRuntime;
  const triggerWrapperRef = useRef<HTMLSpanElement>(null);
  const pointerStartRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const selectionIntentRef = useRef<SideMenuSelectionIntent | null>(null);
  const dragStartedRef = useRef(false);
  const lastPointerActivationAtRef = useRef<number | null>(null);
  const [openState, setOpenState] = useState<NfmSideMenuOpenState | null>(null);
  const freezeController = useMemo(
    () => createSideMenuFreezeController(sideMenu),
    [sideMenu],
  );

  const dragTargetBlock = useMemo(
    () => (block ? resolveCardRefOwnerDragBlock(runtimeEditor as Parameters<typeof resolveCardRefOwnerDragBlock>[0], block) : block),
    [block, runtimeEditor],
  ) as SideMenuBlock | undefined;

  const dataAttributes = useMemo(() => {
    if (!block) return {};

    const attrs: Record<string, string> = {
      "data-block-type": block.type ?? "",
    };

    if (block.type === "heading") {
      const level = toNumberProp(block.props, "level");
      if (level !== null) attrs["data-level"] = level.toString();
    }

    if (
      block.type
      && runtimeEditor.schema.blockSpecs[block.type]?.implementation?.meta?.fileBlockAccept
    ) {
      attrs["data-url"] = toStringProp(block.props, "url").length > 0 ? "true" : "false";
    }

    return attrs;
  }, [block, runtimeEditor.schema.blockSpecs]);

  const close = useCallback(() => {
    setOpenState(null);
    freezeController.release();
  }, [freezeController]);

  const openFromHandle = useCallback((
    returnFocusElement: HTMLElement | null,
    selectionIntent?: SideMenuSelectionIntent | null,
  ) => {
    if (!block) return;
    const rect = triggerWrapperRef.current?.getBoundingClientRect();
    if (!rect) return;

    const resolvedSelectionIntent = selectionIntent ?? createSideMenuSelectionIntent(runtimeEditor, block);
    applySideMenuSelectionIntent(runtimeEditor, resolvedSelectionIntent);
    freezeController.handleMenuOpenChange(true);
    setOpenState({
      block,
      anchorRect: {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      },
      returnFocusElement,
      selectionIntent: resolvedSelectionIntent,
    });
  }, [block, freezeController, runtimeEditor]);

  useEffect(() => () => {
    freezeController.release();
  }, [freezeController]);

  if (!block || !dragTargetBlock) return null;

  return (
    <Components.SideMenu.Root className="bn-side-menu" {...dataAttributes}>
      <NfmAddBlockButton />
      <span ref={triggerWrapperRef} className="inline-flex">
        <SideMenuButton
          label={dict.side_menu.drag_handle_label}
          draggable={true}
          onPointerDown={(event) => {
            if (event.pointerType !== "mouse" || event.button !== 0) return;
            dragStartedRef.current = false;
            selectionIntentRef.current = createSideMenuSelectionIntent(runtimeEditor, block);
            pointerStartRef.current = {
              x: event.clientX,
              y: event.clientY,
              moved: false,
            };
          }}
          onPointerMove={(event) => {
            const start = pointerStartRef.current;
            if (!start) return;
            const distance = Math.hypot(event.clientX - start.x, event.clientY - start.y);
            if (distance > SIDE_MENU_CLICK_TOLERANCE) {
              start.moved = true;
              selectionIntentRef.current = null;
            }
          }}
          onPointerUp={(event) => {
            if (event.pointerType !== "mouse" || event.button !== 0) return;
            const start = pointerStartRef.current;
            pointerStartRef.current = null;
            if (!start || start.moved || dragStartedRef.current) return;

            const selectionIntent = selectionIntentRef.current;
            selectionIntentRef.current = null;
            lastPointerActivationAtRef.current = performance.now();
            openFromHandle(event.currentTarget, selectionIntent);
          }}
          onClick={() => {
            const lastPointerActivationAt = lastPointerActivationAtRef.current;
            if (lastPointerActivationAt !== null && performance.now() - lastPointerActivationAt < 500) {
              lastPointerActivationAtRef.current = null;
              return;
            }

            selectionIntentRef.current = null;
            openFromHandle(
              triggerWrapperRef.current,
              createSideMenuSelectionIntent(runtimeEditor, block),
            );
          }}
          onDragStart={(event: { dataTransfer: DataTransfer | null; clientY: number }) => {
            dragStartedRef.current = true;
            selectionIntentRef.current = null;
            sideMenu.blockDragStart(event, dragTargetBlock as never);
          }}
          onDragEnd={() => {
            dragStartedRef.current = false;
            sideMenu.blockDragEnd();
          }}
          className="bn-button"
          icon={<NfmSideMenuDragHandleIcon className="pointer-events-none" />}
        />
      </span>
      <NfmSideMenuPopup
        openState={openState}
        editor={runtimeEditor}
        releaseSideMenuFreeze={freezeController.release}
        onClose={close}
      />
    </Components.SideMenu.Root>
  );
}
