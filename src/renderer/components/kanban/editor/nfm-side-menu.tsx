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
  useEditorState,
  useExtension,
  useExtensionState,
} from "@blocknote/react";
import {
  Plus,
} from "lucide-react";
import {
  Fragment,
  createContext,
  forwardRef,
  useContext,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
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
  NfmSideMenuSuggestEditsIcon,
  NfmSideMenuTableHeaderIcon,
  NfmSideMenuTextBlockIcon,
  NfmSideMenuToggleListBlockIcon,
  NfmSideMenuTurnIntoIcon,
} from "@/components/shared/icons";
import {
  NodexPopover,
  NodexPopoverAnchor,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { NfmEditorPopoverContent } from "./nfm-editor-popover-content";
import { NfmMoveToMenu } from "./nfm-move-to-menu";
import type { NfmMoveToDestination, NfmMoveToResultScope } from "./nfm-move-to-menu-model";
import {
  buildNfmSideMenuSections,
  filterNfmSideMenuSections,
  flattenNfmSideMenuRows,
  getInitialNfmSideMenuFocusIndex,
  moveNfmSideMenuFocus,
  resolveNfmSideMenuScopeTitle,
  shouldRenderNfmSideMenuSeparatorBefore,
  type NfmSideMenuAction,
  type NfmSideMenuActionKey,
  type NfmSideMenuFlatRow,
  type NfmSideMenuSection,
  type NfmSideMenuSubmenuKey,
  type NfmSideMenuTargetBlockDescriptor,
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
  createSideMenuDragSelectionSnapshot,
  createSideMenuSelectionIntent,
  type SideMenuDragSelectionSnapshot,
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
  getBlock?: (blockId: string) => SideMenuBlock | undefined;
  getParentBlock?: (blockId: string) => unknown;
  getSelection?: () => { blocks?: SideMenuBlock[] } | undefined;
  getTextCursorPosition?: () => { block?: SideMenuBlock };
  setTextCursorPosition?: (block: SideMenuBlock | string, placement?: "start" | "end") => void;
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
    focus?: () => void;
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
  onDragStart?: (event: SideMenuDragStartEvent) => void;
  onDragEnd?: () => void;
  draggable?: boolean;
}

interface SideMenuDragStartEvent {
  dataTransfer: DataTransfer | null;
  clientY: number;
  selectedBlockIds?: string[];
  selectionFrom?: number;
  selectionTo?: number;
}

interface NfmSideMenuOpenState {
  block: SideMenuBlock;
  anchorRect: NfmSideMenuRect;
  returnFocusElement: HTMLElement | null;
  outsidePressIgnoreElement: HTMLElement | null;
  selectionIntent: SideMenuSelectionIntent;
}

export type NfmSideMenuCloseReason = "action" | "escape" | "editor-outside-pointer" | "outside-pointer";

interface NfmSideMenuOpenBlockInput {
  block: SideMenuBlock;
  anchorRect: NfmSideMenuRect;
  returnFocusElement: HTMLElement | null;
  outsidePressIgnoreElement?: HTMLElement | null;
  selectionIntent?: SideMenuSelectionIntent | null;
  freezeSideMenu?: boolean;
}

interface NfmSideMenuOpenSelectionInput {
  anchorRect?: NfmSideMenuRect | null;
  returnFocusElement?: HTMLElement | null;
  outsidePressIgnoreElement?: HTMLElement | null;
}

interface NfmSideMenuOpenController {
  openForBlock: (input: NfmSideMenuOpenBlockInput) => boolean;
  openForCurrentSelection: (input?: NfmSideMenuOpenSelectionInput) => boolean;
  formattingToolbarSuppressionRange: NfmSideMenuSelectionRange | null;
}

export interface NfmSideMenuSelectionRange {
  from: number;
  to: number;
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
  sourceProjectId: string | null;
  sourceCardId: string | null;
  textColor: string;
  backgroundColor: string;
  footerPrimary: string | null;
  footerSecondary: string | null;
  onQueryChange: (query: string) => void;
  onFocusIndexChange: (index: number) => void;
  onMoveFocus: (direction: 1 | -1) => void;
  onActivateFocused: () => void;
  onClose: () => void;
  onAction: (row: NfmSideMenuAction) => void;
  onSubmenuChange: (submenu: NfmSideMenuSubmenuKey | null) => void;
  onTurnInto: (item: NfmSideMenuTurnIntoItem) => void;
  onColor: (kind: "text" | "background", color: NfmSideMenuColorValue) => void;
  onMoveBlocksToDestination: (destination: NfmMoveToDestination) => Promise<void> | void;
  renderMoveToMenu?: (props: {
    sourceProjectId: string | null;
    sourceCardId: string | null;
    onAccept: (destination: NfmMoveToDestination) => Promise<void> | void;
    onClose: () => void;
    resultScope?: NfmMoveToResultScope;
    ariaLabel?: string;
    placeholder?: string;
  }) => ReactNode;
}

const SIDE_MENU_CLICK_TOLERANCE = 4;
const SIDE_MENU_SHORTCUT_KEY = "/";
const SIDE_MENU_SUBMENU_SELECTOR = "[data-nfm-side-menu-submenu='true']";
const SIDE_MENU_MOTION_DURATION_MS = 200;
const SIDE_MENU_MOTION_DELAY_MS = 30;
const SIDE_MENU_EXIT_FALLBACK_MS = SIDE_MENU_MOTION_DURATION_MS + SIDE_MENU_MOTION_DELAY_MS + 50;
const SIDE_MENU_CLOSED_SCALE = 0.97;
const NFM_SIDE_MENU_OPEN_SELECTION_KEY = "nfmSideMenu";
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

const DEFAULT_SIDE_MENU_OPEN_CONTROLLER: NfmSideMenuOpenController = {
  openForBlock: () => false,
  openForCurrentSelection: () => false,
  formattingToolbarSuppressionRange: null,
};

const NfmSideMenuOpenContext = createContext<NfmSideMenuOpenController>(
  DEFAULT_SIDE_MENU_OPEN_CONTROLLER,
);

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
  { key: "toggle-heading-1", label: "Toggle heading 1", type: "heading", props: { level: 1, isToggleable: true } },
  { key: "toggle-heading-2", label: "Toggle heading 2", type: "heading", props: { level: 2, isToggleable: true } },
  { key: "toggle-heading-3", label: "Toggle heading 3", type: "heading", props: { level: 3, isToggleable: true } },
  { key: "bullet-list", label: "Bulleted list", type: "bulletListItem" },
  { key: "numbered-list", label: "Numbered list", type: "numberedListItem" },
  { key: "todo-list", label: "To-do list", type: "checkListItem" },
  { key: "toggle-list", label: "Toggle list", type: "toggleListItem" },
  { key: "quote", label: "Quote", type: "quote" },
  { key: "callout", label: "Callout", type: "callout" },
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

export function shouldCloseNfmSideMenuForPointerTarget({
  target,
  popupElement,
  outsidePressIgnoreElement,
}: {
  target: EventTarget | null;
  popupElement: HTMLElement | null;
  outsidePressIgnoreElement: HTMLElement | null;
}) {
  if (!(target instanceof Node)) return false;
  if (getClosestElement(target)?.closest(SIDE_MENU_SUBMENU_SELECTOR)) return false;
  if (popupElement?.contains(target)) return false;
  if (outsidePressIgnoreElement?.contains(target)) return false;
  return true;
}

export function shouldConsumeNfmSideMenuOutsidePointerTarget({
  target,
  editorRoot,
}: {
  target: EventTarget | null;
  editorRoot: HTMLElement | null;
}) {
  if (!editorRoot || !(target instanceof Node)) return false;
  return editorRoot.contains(target);
}

export function shouldReturnFocusAfterNfmSideMenuClose({
  reason,
  returnFocusElement,
}: {
  reason: NfmSideMenuCloseReason;
  returnFocusElement: HTMLElement | null;
}) {
  if (!returnFocusElement) return false;
  return reason !== "outside-pointer";
}

export function resolveNfmSideMenuReturnFocusElement({
  reason,
  returnFocusElement,
  editorRoot,
}: {
  reason: NfmSideMenuCloseReason;
  returnFocusElement: HTMLElement | null;
  editorRoot: HTMLElement | null;
}) {
  if (reason === "editor-outside-pointer") return editorRoot;
  return returnFocusElement;
}

export function resolveNfmSideMenuFormattingToolbarSuppressionRange({
  reason,
  selectionRange,
}: {
  reason: NfmSideMenuCloseReason;
  selectionRange: NfmSideMenuSelectionRange | null;
}) {
  if (reason === "action") return null;
  if (!selectionRange) return null;
  if (selectionRange.from === selectionRange.to) return null;
  return selectionRange;
}

export function shouldKeepNfmSideMenuFormattingToolbarSuppression({
  selectionRange,
  suppressionRange,
}: {
  selectionRange: NfmSideMenuSelectionRange;
  suppressionRange: NfmSideMenuSelectionRange | null;
}) {
  return suppressionRange !== null
    && selectionRange.from === suppressionRange.from
    && selectionRange.to === suppressionRange.to;
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

function toSideMenuTargetBlockDescriptor(block: SideMenuBlock): NfmSideMenuTargetBlockDescriptor {
  return {
    id: getCurrentBlockId(block),
    type: typeof block.type === "string" ? block.type : null,
    props: block.props,
  };
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
  if (item.key === "heading-1" || item.key === "toggle-heading-1") {
    return <NfmSideMenuHeadingBlockIcon level={1} />;
  }
  if (item.key === "heading-2" || item.key === "toggle-heading-2") {
    return <NfmSideMenuHeadingBlockIcon level={2} />;
  }
  if (item.key === "heading-3" || item.key === "toggle-heading-3") {
    return <NfmSideMenuHeadingBlockIcon level={3} />;
  }
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

function focusNfmSideMenuReturnTarget(
  editor: SideMenuEditorRuntime,
  returnFocusElement: HTMLElement,
) {
  if (editor.prosemirrorView?.dom === returnFocusElement && editor.prosemirrorView.focus) {
    editor.prosemirrorView.focus();
    return;
  }

  try {
    returnFocusElement.focus({ preventScroll: true });
  } catch {
    returnFocusElement.focus();
  }
}

function getCurrentNfmSideMenuSelectionRange(
  editor: SideMenuEditorRuntime,
): NfmSideMenuSelectionRange | null {
  const selection = editor.prosemirrorView?.state.selection;
  if (!selection || selection.empty) return null;
  return {
    from: selection.from,
    to: selection.to,
  };
}

function prefersReducedMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
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
      {row.mockReason ? (
        <span
          title={row.mockReason}
          className="shrink-0 rounded-[4px] bg-token-foreground/5 px-1 text-[10px] font-medium uppercase leading-4 text-token-description-foreground"
        >
          Mock
        </span>
      ) : null}
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

  const submenuWidth = row.submenu === "move-to" ? 330 : 226;
  const isMoveToSubmenu = row.submenu === "move-to";

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
      <NfmEditorPopoverContent
        side="right"
        align="start"
        sideOffset={6}
        alignOffset={-4}
        aria-label={row.label}
        data-nfm-side-menu-submenu="true"
        className={cn(
          "text-[14px] leading-[1.2] shadow-xl-spread backdrop-blur-xl",
          isMoveToSubmenu
            ? "w-[330px] max-w-[calc(100vw-24px)] overflow-hidden p-0"
            : "w-[226px] overflow-y-auto p-1",
        )}
        style={{ width: submenuWidth }}
      >
        {submenuContent}
      </NfmEditorPopoverContent>
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

type NfmSideMenuSubmenuRowProps = Omit<
  ComponentPropsWithoutRef<"div">,
  "children" | "onClick" | "onPointerEnter"
> & {
  children: ReactNode;
  disabled?: boolean;
  selected?: boolean;
  onClick?: () => void;
  onPointerEnter?: () => void;
  leftSlot?: ReactNode;
  rightSlot?: ReactNode;
  ariaHaspopup?: "dialog";
  ariaExpanded?: boolean;
};

const NfmSideMenuSubmenuRow = forwardRef<HTMLDivElement, NfmSideMenuSubmenuRowProps>(function NfmSideMenuSubmenuRow({
  children,
  disabled = false,
  selected = false,
  onClick,
  onPointerEnter,
  leftSlot,
  rightSlot,
  ariaHaspopup,
  ariaExpanded,
  className,
  ...props
}, forwardedRef) {
  return (
    <div
      {...props}
      ref={forwardedRef}
      role="menuitem"
      tabIndex={-1}
      aria-disabled={disabled || undefined}
      aria-current={selected ? "true" : undefined}
      aria-haspopup={ariaHaspopup}
      aria-expanded={ariaExpanded}
      className={cn(
        "flex h-7 select-none items-center gap-2 rounded-[7px] px-2 text-[14px] leading-7 outline-hidden",
        disabled
          ? "cursor-default text-token-text-secondary opacity-45"
          : "cursor-interaction text-token-foreground hover:bg-token-list-hover-background",
        className,
      )}
      onPointerDown={keepEditorSelection}
      onPointerEnter={onPointerEnter}
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
});

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
  sourceProjectId,
  sourceCardId,
  textColor,
  backgroundColor,
  onTurnInto,
  onColor,
  onMoveBlocksToDestination,
  renderMoveToMenu,
}: Pick<
  NfmSideMenuSurfaceProps,
  | "turnIntoItems"
  | "colorOptions"
  | "canUseTextColor"
  | "canUseBackgroundColor"
  | "canSendBlocks"
  | "sourceProjectId"
  | "sourceCardId"
  | "textColor"
  | "backgroundColor"
  | "onTurnInto"
  | "onColor"
  | "onMoveBlocksToDestination"
  | "renderMoveToMenu"
> & {
  submenu: NfmSideMenuSubmenuKey;
}) {
  const cardInRowRef = useRef<HTMLDivElement>(null);
  const [cardInOpen, setCardInOpen] = useState(false);
  const closeCardInAndRestoreFocus = useCallback(() => {
    setCardInOpen(false);
    requestAnimationFrame(() => {
      cardInRowRef.current?.focus();
    });
  }, []);
  const cardInMenuProps = {
    sourceProjectId,
    sourceCardId,
    onAccept: onMoveBlocksToDestination,
    onClose: closeCardInAndRestoreFocus,
    resultScope: "db-only" as const,
    ariaLabel: "Card in destination",
    placeholder: "Card in…",
  };

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
              onPointerEnter={() => setCardInOpen(false)}
              onClick={() => onTurnInto(item)}
            >
              {item.label}
            </NfmSideMenuSubmenuRow>
          ))}
          <div className="mx-2 my-1 h-px bg-token-menu-border" />
          <NodexPopover
            open={cardInOpen}
            onOpenChange={(open) => {
              if (open && canSendBlocks) {
                setCardInOpen(true);
                return;
              }
              setCardInOpen(false);
            }}
          >
            <NodexPopoverAnchor asChild>
              <NfmSideMenuSubmenuRow
                ref={cardInRowRef}
                leftSlot={<NfmSideMenuPageInIcon />}
                rightSlot={<NfmSideMenuChevronRightIcon className="text-token-description-foreground" />}
                disabled={!canSendBlocks}
                ariaHaspopup="dialog"
                ariaExpanded={cardInOpen}
                onPointerEnter={() => {
                  if (canSendBlocks) setCardInOpen(true);
                }}
                onClick={() => {
                  setCardInOpen(true);
                }}
              >
                Card in
              </NfmSideMenuSubmenuRow>
            </NodexPopoverAnchor>
            <NfmEditorPopoverContent
              side="right"
              align="start"
              sideOffset={6}
              alignOffset={-4}
              aria-label="Card in"
              data-nfm-side-menu-submenu="true"
              className="w-[330px] max-w-[calc(100vw-24px)] overflow-hidden p-0 text-[14px] leading-[1.2] shadow-xl-spread backdrop-blur-xl"
              style={{ width: 330 }}
            >
              {renderMoveToMenu?.(cardInMenuProps) ?? (
                <NfmMoveToMenu {...cardInMenuProps} />
              )}
            </NfmEditorPopoverContent>
          </NodexPopover>
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
  sourceProjectId,
  sourceCardId,
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
  onMoveBlocksToDestination,
  renderMoveToMenu,
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
  const closeSubmenuAndRestoreFocus = () => {
    onSubmenuChange(null);
    requestAnimationFrame(() => {
      document.getElementById(comboboxId)?.focus();
    });
  };
  const renderSubmenu = (submenu: NfmSideMenuSubmenuKey) => {
    if (submenu === "move-to") {
      const moveToMenuProps = {
        sourceProjectId,
        sourceCardId,
        onAccept: onMoveBlocksToDestination,
        onClose: closeSubmenuAndRestoreFocus,
      };

      return renderMoveToMenu?.(moveToMenuProps) ?? (
        <NfmMoveToMenu
          sourceProjectId={sourceProjectId}
          sourceCardId={sourceCardId}
          onAccept={onMoveBlocksToDestination}
          onClose={closeSubmenuAndRestoreFocus}
        />
      );
    }

    return (
      <NfmSideMenuSubmenu
        submenu={submenu}
        turnIntoItems={turnIntoItems}
        colorOptions={colorOptions}
        canUseTextColor={canUseTextColor}
        canUseBackgroundColor={canUseBackgroundColor}
        canSendBlocks={canSendBlocks}
        sourceProjectId={sourceProjectId}
        sourceCardId={sourceCardId}
        textColor={textColor}
        backgroundColor={backgroundColor}
        onTurnInto={onTurnInto}
        onColor={onColor}
        onMoveBlocksToDestination={onMoveBlocksToDestination}
        renderMoveToMenu={renderMoveToMenu}
      />
    );
  };

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
        {footerPrimary || footerSecondary ? (
          <div className="px-1 pb-1 text-[12px] leading-4 text-token-description-foreground">
            <NfmSideMenuSeparator kind="footer" />
            <div className="px-2 py-1.5">
              {footerPrimary ? <div className="truncate">{footerPrimary}</div> : null}
              {footerSecondary ? <div className="truncate">{footerSecondary}</div> : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function NfmSideMenuPopup({
  openState,
  editor,
  releaseSideMenuFreeze,
  onCloseSelection,
  onClose,
}: {
  openState: NfmSideMenuOpenState | null;
  editor: SideMenuEditorRuntime;
  releaseSideMenuFreeze?: () => void;
  onCloseSelection: (reason: NfmSideMenuCloseReason) => void;
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
  const closeTimerRef = useRef<number | null>(null);
  const pendingCloseRef = useRef(false);
  const [query, setQuery] = useState("");
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [activeSubmenu, setActiveSubmenu] = useState<NfmSideMenuSubmenuKey | null>(null);
  const [position, setPosition] = useState<NfmSideMenuPosition | null>(null);
  const [visible, setVisible] = useState(false);

  const block = openState?.block;
  const selectedActionBlocks = useMemo(
    () => (openState && block ? getSideMenuActionBlocks(openState, block) : []),
    [block, openState],
  );
  const topLevelSelectedBlocks = useMemo(
    () => getTopLevelSideMenuActionBlocks(selectedActionBlocks),
    [selectedActionBlocks],
  );
  const selectedTopLevelBlock = topLevelSelectedBlocks[0] ?? block ?? null;
  const currentBlockId = selectedTopLevelBlock ? getCurrentBlockId(selectedTopLevelBlock) : null;
  const colorTargetBlocks = selectedActionBlocks.length > 0
    ? selectedActionBlocks
    : block ? [block] : [];
  const colorSupport = useMemo(() => {
    if (colorTargetBlocks.length === 0) return { text: false, background: false };

    return colorTargetBlocks.reduce(
      (acc, selectedBlock) => {
        const selectedSupport = supportsBlockColor(editor, selectedBlock);
        return {
          text: acc.text && selectedSupport.text,
          background: acc.background && selectedSupport.background,
        };
      },
      { text: true, background: true },
    );
  }, [colorTargetBlocks, editor]);
  const runtimeSnapshot = runtime.getSnapshot();
  const selectionTitle = useMemo(
    () => resolveNfmSideMenuScopeTitle(topLevelSelectedBlocks.map(toSideMenuTargetBlockDescriptor)),
    [topLevelSelectedBlocks],
  );
  const isEditable = getEditorEditable(editor);
  const baseSections = useMemo(() => buildNfmSideMenuSections({
    currentBlockId,
    currentBlockType: selectedTopLevelBlock?.type ?? null,
    selectionTitle,
    selectedTopLevelBlockCount: topLevelSelectedBlocks.length,
    isEditable,
    canUseColor: colorSupport.text || colorSupport.background,
    canSendBlocks: runtimeSnapshot.canSendBlocks,
    hasConvertDividerToThreadSection: runtimeSnapshot.hasConvertDividerToThreadSection,
    isTableBlock: selectedTopLevelBlock?.type === "table",
    canUseTableHeaders: editor.settings?.tables?.headers === true,
    showMockActions: import.meta.env.DEV,
  }), [
    selectedTopLevelBlock?.type,
    colorSupport.background,
    colorSupport.text,
    currentBlockId,
    editor.settings?.tables?.headers,
    runtimeSnapshot.hasConvertDividerToThreadSection,
    isEditable,
    runtimeSnapshot.canSendBlocks,
    selectionTitle,
    topLevelSelectedBlocks.length,
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

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current === null) return;
    window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  }, []);

  const finalizeClose = useCallback(() => {
    if (!pendingCloseRef.current) return;
    pendingCloseRef.current = false;
    clearCloseTimer();
    setQuery("");
    setFocusedIndex(-1);
    setActiveSubmenu(null);
    setPosition(null);
    onClose();
  }, [clearCloseTimer, onClose]);

  const close = useCallback((reason: NfmSideMenuCloseReason = "action") => {
    if (!openState || pendingCloseRef.current) return;

    formattingToolbar.store.setState(false);
    onCloseSelection(reason);
    pendingCloseRef.current = true;
    setVisible(false);
    setActiveSubmenu(null);
    releaseSideMenuFreeze?.();
    const returnFocusElement = resolveNfmSideMenuReturnFocusElement({
      reason,
      returnFocusElement: openState.returnFocusElement,
      editorRoot: editor.prosemirrorView?.dom ?? null,
    });

    if (shouldReturnFocusAfterNfmSideMenuClose({
      reason,
      returnFocusElement,
    })) {
      requestAnimationFrame(() => {
        if (!returnFocusElement) return;
        focusNfmSideMenuReturnTarget(editor, returnFocusElement);
      });
    }

    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(
      finalizeClose,
      prefersReducedMotion() ? 0 : SIDE_MENU_EXIT_FALLBACK_MS,
    );
  }, [
    clearCloseTimer,
    editor,
    finalizeClose,
    formattingToolbar.store,
    onCloseSelection,
    openState,
    releaseSideMenuFreeze,
  ]);

  useEffect(() => {
    if (!openState) {
      setVisible(false);
      return;
    }

    pendingCloseRef.current = false;
    clearCloseTimer();
    setQuery("");
    setFocusedIndex(-1);
    setActiveSubmenu(null);
    setVisible(false);

    const animationFrame = requestAnimationFrame(() => {
      setVisible(true);
    });

    return () => {
      cancelAnimationFrame(animationFrame);
    };
  }, [clearCloseTimer, openState]);

  useEffect(() => () => {
    clearCloseTimer();
  }, [clearCloseTimer]);

  useEffect(() => {
    if (!openState || !visible) return;
    formattingToolbar.store.setState(false);
    showSelection(true, NFM_SIDE_MENU_OPEN_SELECTION_KEY);
    return () => showSelection(false, NFM_SIDE_MENU_OPEN_SELECTION_KEY);
  }, [formattingToolbar.store, openState, showSelection, visible]);

  const executeAction = useCallback((key: NfmSideMenuActionKey) => {
    if (!block || !currentBlockId || !openState) return;

    const selectedBlocks = getSideMenuActionBlocks(openState, block);
    const topLevelSelectedBlocks = getTopLevelSideMenuActionBlocks(selectedBlocks);

    if (!isEditable) return;

    if (key === "duplicate") {
      const referenceBlock = topLevelSelectedBlocks[topLevelSelectedBlocks.length - 1] ?? block;
      editor.insertBlocks?.(topLevelSelectedBlocks.map(cloneBlockForInsert), referenceBlock, "after");
      close("action");
      return;
    }

    if (key === "delete") {
      editor.removeBlocks?.(topLevelSelectedBlocks);
      close("action");
      return;
    }

    if (key === "convert-divider-to-thread-section") {
      runtimeSnapshot.onConvertDividerToThreadSection(currentBlockId);
      close("action");
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
      close("action");
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
    if (!openState || !visible) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!shouldCloseNfmSideMenuForPointerTarget({
        target: event.target,
        popupElement: popupRef.current,
        outsidePressIgnoreElement: openState.outsidePressIgnoreElement,
      })) {
        return;
      }
      const shouldConsumePointer = shouldConsumeNfmSideMenuOutsidePointerTarget({
        target: event.target,
        editorRoot: editor.prosemirrorView?.dom ?? null,
      });

      if (shouldConsumePointer) {
        event.preventDefault();
        event.stopPropagation();
        close("editor-outside-pointer");
        return;
      }

      close("outside-pointer");
    };
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      close("escape");
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [close, openState, visible]);

  useEffect(() => {
    if (!openState || !visible) return;
    requestAnimationFrame(() => {
      popupRef.current?.querySelector<HTMLInputElement>("input[role='combobox']")?.focus();
    });
  }, [openState, visible]);

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
        opacity: visible ? 1 : 0,
        pointerEvents: visible ? "auto" : "none",
        transform: `scale(${visible ? 1 : SIDE_MENU_CLOSED_SCALE})`,
        transitionDelay: `${SIDE_MENU_MOTION_DELAY_MS}ms`,
        "--nfm-side-menu-origin": position.transformOrigin,
      } as CSSProperties}
      contentEditable={false}
      data-nfm-side-menu-popup="true"
      data-state={visible ? "open" : "closed"}
      onTransitionEnd={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.propertyName !== "opacity") return;
        if (visible) return;
        finalizeClose();
      }}
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
        sourceProjectId={runtimeSnapshot.sourceProjectId}
        sourceCardId={runtimeSnapshot.sourceCardId}
        textColor={toStringProp(block.props, "textColor")}
        backgroundColor={toStringProp(block.props, "backgroundColor")}
        footerPrimary={null}
        footerSecondary={null}
        onQueryChange={setQuery}
        onFocusIndexChange={setFocusedIndex}
        onMoveFocus={(direction) => {
          setFocusedIndex((currentIndex) => moveNfmSideMenuFocus(currentIndex, direction, flatRows));
        }}
        onActivateFocused={activateFocusedRow}
        onClose={() => close("escape")}
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
          close("action");
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
          close("action");
        }}
        onMoveBlocksToDestination={async (destination) => {
          if (!currentBlockId) {
            throw new Error("No block selected.");
          }
          await runtimeSnapshot.onMoveBlocksToDestination(destination, currentBlockId);
          close("action");
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
  const rect = blockElement?.getBoundingClientRect();
  if (!rect) return null;

  return {
    left: rect.left - 8,
    top: rect.top,
    width: 18,
    height: Math.min(Math.max(rect.height, 24), 40),
  };
}

export function useNfmSideMenuOpenController() {
  return useContext(NfmSideMenuOpenContext);
}

export function NfmSideMenuOpenProvider({ children }: { children: ReactNode }) {
  const blockNoteEditor = useBlockNoteEditor();
  const editor = blockNoteEditor as unknown as SideMenuEditorRuntime;
  const sideMenu = useExtension(SideMenuExtension);
  const [openState, setOpenState] = useState<NfmSideMenuOpenState | null>(null);
  const [formattingToolbarSuppressionRange, setFormattingToolbarSuppressionRange] =
    useState<NfmSideMenuSelectionRange | null>(null);
  const selectionRange = useEditorState({
    editor: blockNoteEditor,
    selector: ({ editor }) => ({
      from: editor.prosemirrorState.selection.from,
      to: editor.prosemirrorState.selection.to,
    }),
  });
  const freezeController = useMemo(
    () => createSideMenuFreezeController(sideMenu),
    [sideMenu],
  );

  const close = useCallback(() => {
    setOpenState(null);
    freezeController.release();
  }, [freezeController]);

  const captureFormattingToolbarSuppression = useCallback((reason: NfmSideMenuCloseReason) => {
    setFormattingToolbarSuppressionRange(resolveNfmSideMenuFormattingToolbarSuppressionRange({
      reason,
      selectionRange: getCurrentNfmSideMenuSelectionRange(editor),
    }));
  }, [editor]);

  const openForBlock = useCallback(({
    block,
    anchorRect,
    returnFocusElement,
    outsidePressIgnoreElement = null,
    selectionIntent,
    freezeSideMenu = false,
  }: NfmSideMenuOpenBlockInput) => {
    const resolvedSelectionIntent = selectionIntent
      ?? createSideMenuSelectionIntent(editor, block);

    setFormattingToolbarSuppressionRange(null);
    applySideMenuSelectionIntent(editor, resolvedSelectionIntent);

    if (freezeSideMenu) {
      freezeController.handleMenuOpenChange(true);
    } else {
      freezeController.release();
    }

    setOpenState({
      block,
      anchorRect,
      returnFocusElement,
      outsidePressIgnoreElement,
      selectionIntent: resolvedSelectionIntent,
    });
    return true;
  }, [editor, freezeController]);

  const openForCurrentSelection = useCallback((input: NfmSideMenuOpenSelectionInput = {}) => {
    const block = editor.getSelection?.()?.blocks?.[0]
      ?? editor.getTextCursorPosition?.().block;
    if (!block) return false;

    const anchorRect = resolveShortcutAnchorRect(editor, block)
      ?? input.anchorRect
      ?? null;
    if (!anchorRect) return false;

    return openForBlock({
      block,
      anchorRect,
      returnFocusElement: input.returnFocusElement ?? editor.prosemirrorView?.dom ?? null,
      outsidePressIgnoreElement: input.outsidePressIgnoreElement ?? null,
    });
  }, [editor, openForBlock]);

  const value = useMemo<NfmSideMenuOpenController>(() => ({
    openForBlock,
    openForCurrentSelection,
    formattingToolbarSuppressionRange,
  }), [
    formattingToolbarSuppressionRange,
    openForBlock,
    openForCurrentSelection,
  ]);

  const shouldKeepSuppressionRange = shouldKeepNfmSideMenuFormattingToolbarSuppression({
    selectionRange,
    suppressionRange: formattingToolbarSuppressionRange,
  });

  useEffect(() => {
    if (!formattingToolbarSuppressionRange) return;
    if (shouldKeepSuppressionRange) return;
    setFormattingToolbarSuppressionRange(null);
  }, [
    formattingToolbarSuppressionRange,
    shouldKeepSuppressionRange,
  ]);

  useEffect(() => () => {
    freezeController.release();
  }, [freezeController]);

  return (
    <NfmSideMenuOpenContext.Provider value={value}>
      {children}
      <NfmSideMenuPopup
        openState={openState}
        editor={editor}
        releaseSideMenuFreeze={freezeController.release}
        onCloseSelection={captureFormattingToolbarSuppression}
        onClose={close}
      />
    </NfmSideMenuOpenContext.Provider>
  );
}

export function NfmSideMenuShortcutController() {
  const editor = useBlockNoteEditor() as unknown as SideMenuEditorRuntime;
  const sideMenuOpenController = useNfmSideMenuOpenController();

  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== SIDE_MENU_SHORTCUT_KEY) return;
      if (!event.metaKey && !event.ctrlKey) return;
      if (event.shiftKey || event.altKey) return;

      const editorRoot = editor.prosemirrorView?.dom;
      if (editorRoot && document.activeElement && !editorRoot.contains(document.activeElement)) {
        return;
      }

      const opened = sideMenuOpenController.openForCurrentSelection({
        returnFocusElement: editorRoot ?? null,
      });
      if (!opened) return;

      event.preventDefault();
    };

    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [editor, sideMenuOpenController]);

  return null;
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
  const dragSelectionSnapshotRef = useRef<SideMenuDragSelectionSnapshot | null>(null);
  const dragStartedRef = useRef(false);
  const lastPointerActivationAtRef = useRef<number | null>(null);
  const sideMenuOpenController = useNfmSideMenuOpenController();

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

  const openFromHandle = useCallback((
    returnFocusElement: HTMLElement | null,
    selectionIntent?: SideMenuSelectionIntent | null,
  ) => {
    if (!block) return;
    const rect = triggerWrapperRef.current?.getBoundingClientRect();
    if (!rect) return;

    sideMenuOpenController.openForBlock({
      block,
      anchorRect: {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      },
      returnFocusElement,
      outsidePressIgnoreElement: triggerWrapperRef.current,
      selectionIntent,
      freezeSideMenu: true,
    });
  }, [block, sideMenuOpenController]);

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
            dragSelectionSnapshotRef.current = createSideMenuDragSelectionSnapshot(runtimeEditor);
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
            if (!start || start.moved || dragStartedRef.current) {
              if (!dragStartedRef.current) {
                dragSelectionSnapshotRef.current = null;
              }
              return;
            }

            const selectionIntent = selectionIntentRef.current;
            selectionIntentRef.current = null;
            dragSelectionSnapshotRef.current = null;
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
            dragSelectionSnapshotRef.current = null;
            openFromHandle(
              triggerWrapperRef.current,
              createSideMenuSelectionIntent(runtimeEditor, block),
            );
          }}
          onDragStart={(event: SideMenuDragStartEvent) => {
            dragStartedRef.current = true;
            selectionIntentRef.current = null;
            const dragEvent = {
              ...event,
              ...(dragSelectionSnapshotRef.current ?? {}),
            };
            sideMenu.blockDragStart(dragEvent, dragTargetBlock as never);
          }}
          onDragEnd={() => {
            dragStartedRef.current = false;
            dragSelectionSnapshotRef.current = null;
            sideMenu.blockDragEnd();
          }}
          className="bn-button"
          icon={<NfmSideMenuDragHandleIcon className="pointer-events-none" />}
        />
      </span>
    </Components.SideMenu.Root>
  );
}
