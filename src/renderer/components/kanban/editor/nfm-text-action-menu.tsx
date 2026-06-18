import {
  editorHasBlockWithType,
  isTableCellSelection,
} from "@blocknote/core";
import {
  useBlockNoteEditor,
  useEditorState,
} from "@blocknote/react";
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  CheckmarkIcon,
  ChevronRightIcon,
  TextActionBoldIcon,
  TextActionBulletedListBlockIcon,
  TextActionClearFormatIcon,
  TextActionCheckListBlockIcon,
  TextActionCodeIcon,
  TextActionCommentIcon,
  TextActionCommentPencilIcon,
  TextActionEllipsisIcon,
  TextActionEquationIcon,
  TextActionHeadingBlockIcon,
  TextActionItalicIcon,
  TextActionLinkIcon,
  TextActionNormalTextIcon,
  TextActionNumberedListBlockIcon,
  TextActionPencilSmallIcon,
  TextActionQuoteBlockIcon,
  TextActionReactionIcon,
  TextActionSlidersIcon,
  TextActionStrikeIcon,
  TextActionToggleListBlockIcon,
  TextActionUnderlineIcon,
} from "@/components/shared/icons";
import {
  NodexDropdownContent,
  NodexDropdownItem,
} from "@/components/ui/dropdown";
import { NodexTooltip } from "@/components/ui/tooltip";
import {
  readTextActionRecentColors,
  recordTextActionRecentColors,
  type TextActionRecentColor,
  type TextActionRecentColorKind,
} from "@/lib/text-action-color-recents";
import { cn } from "@/lib/utils";
import {
  applyTextActionBlockType,
  applyTextActionClearFormat,
  applyTextActionStringStyle,
  applyTextActionToggleStyle,
  textActionHasBooleanStyle,
  textActionHasStringStyle,
  type TextActionEditorAdapter,
  type TextActionBlockTypeUpdate,
} from "./nfm-text-action-menu-actions";
import {
  NfmCreateLinkButton,
  type NfmCreateLinkTriggerProps,
} from "./nfm-link-toolbar";
import type { SendBlocksMode } from "./nfm-drag-handle-menu";
import {
  resolveNodexTextActionRows,
  shouldUseTextActionMenu,
  TEXT_ACTION_BASIC_STYLES,
  TEXT_ACTION_NOTION_COLOR_ORDER,
  TEXT_ACTION_COLOR_VALUES,
  TEXT_ACTION_REFERENCE_SKILLS,
  type TextActionBasicStyle,
  type TextActionColorValue,
  type TextActionNodexRow,
} from "./nfm-text-action-menu-model";
import { useNfmTextActionMenuRuntime } from "./nfm-text-action-menu-runtime";

interface TextActionBlockTypeItem {
  key: string;
  label: string;
  type: string;
  props?: Record<string, boolean | number | string>;
  isSelected: boolean;
}

interface TextActionMenuSnapshot {
  eligible: boolean;
  currentBlockId: string | null;
  currentBlockType: string | null;
  currentBlockTypeLabel: string;
  blockTypeItems: TextActionBlockTypeItem[];
  activeStyles: Partial<Record<TextActionBasicStyle, boolean>>;
  textColor: string;
  backgroundColor: string;
  canUseTextColor: boolean;
  canUseBackgroundColor: boolean;
  canClearFormat: boolean;
}

interface TextActionBlockSnapshot {
  id?: unknown;
  type?: string;
  props?: Record<string, unknown>;
  content?: unknown;
}

interface TextActionSnapshotEditor extends Pick<TextActionEditorAdapter, "schema"> {
  schema: TextActionEditorAdapter["schema"] & {
    inlineContentSchema: Record<string, unknown>;
  };
  prosemirrorState: {
    selection: {
      from: number;
      to: number;
    };
  };
  isEditable: boolean;
  getSelection: () => { blocks: TextActionBlockSnapshot[] } | undefined;
  getTextCursorPosition: () => { block: TextActionBlockSnapshot };
  getActiveStyles: () => Record<string, unknown>;
}

export interface NfmTextActionMenuSurfaceProps {
  currentBlockTypeLabel: string;
  blockTypeItems: TextActionBlockTypeItem[];
  activeStyles: Partial<Record<TextActionBasicStyle, boolean>>;
  textColor: string;
  backgroundColor: string;
  canUseTextColor: boolean;
  canUseBackgroundColor: boolean;
  canClearFormat: boolean;
  linkControl?: ReactNode;
  nodexRows: TextActionNodexRow[];
  canConvertDividerToThreadSection: boolean;
  onSelectBlockType: (item: TextActionBlockTypeItem) => void;
  onToggleStyle: (style: TextActionBasicStyle) => void;
  onSetTextColor: (color: TextActionColorValue) => void;
  onSetBackgroundColor: (color: TextActionColorValue) => void;
  onClearFormat: () => void;
  onNodexRow: (row: TextActionNodexRow) => void;
  onConvertDividerToThreadSection: () => void;
}

const TEXT_ACTION_BLOCK_TYPE_DEFINITIONS = [
  { key: "paragraph", label: "Normal Text", type: "paragraph" },
  { key: "heading-1", label: "Heading 1", type: "heading", props: { level: 1, isToggleable: false } },
  { key: "heading-2", label: "Heading 2", type: "heading", props: { level: 2, isToggleable: false } },
  { key: "heading-3", label: "Heading 3", type: "heading", props: { level: 3, isToggleable: false } },
  { key: "toggle-heading-1", label: "Toggle Heading 1", type: "heading", props: { level: 1, isToggleable: true } },
  { key: "quote", label: "Quote", type: "quote" },
  { key: "bullet-list", label: "Bulleted List", type: "bulletListItem" },
  { key: "numbered-list", label: "Numbered List", type: "numberedListItem" },
  { key: "todo-list", label: "To-do List", type: "checkListItem" },
  { key: "toggle-list", label: "Toggle List", type: "toggleListItem" },
  { key: "code", label: "Code", type: "codeBlock" },
] as const;

const TEXT_ACTION_STYLE_LABELS = {
  bold: "Bold",
  italic: "Italic",
  underline: "Underline",
  strike: "Strikethrough",
  code: "Code",
} as const satisfies Record<TextActionBasicStyle, string>;

const TEXT_ACTION_COLOR_LABELS = {
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
} as const satisfies Record<TextActionColorValue, string>;

const TEXT_ACTION_COLOR_STYLES = {
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
} as const satisfies Record<TextActionColorValue, string>;

const TEXT_ACTION_BACKGROUND_COLOR_STYLES = {
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
} as const satisfies Record<TextActionColorValue, string>;

const TEXT_ACTION_COLOR_BORDER_STYLES = {
  default: "var(--color-token-border)",
  gray: "color-mix(in srgb, var(--color-token-foreground) 26%, transparent)",
  brown: "color-mix(in srgb, var(--color-token-charts-orange) 40%, transparent)",
  orange: "color-mix(in srgb, var(--color-token-charts-orange) 44%, transparent)",
  yellow: "color-mix(in srgb, var(--color-token-charts-yellow) 48%, transparent)",
  green: "color-mix(in srgb, var(--color-token-charts-green) 42%, transparent)",
  blue: "color-mix(in srgb, var(--color-token-charts-blue) 40%, transparent)",
  purple: "color-mix(in srgb, var(--color-token-charts-purple) 42%, transparent)",
  pink: "color-mix(in srgb, var(--color-token-charts-purple) 30%, var(--color-token-charts-red) 28%)",
  red: "color-mix(in srgb, var(--color-token-charts-red) 44%, transparent)",
} as const satisfies Record<TextActionColorValue, string>;

function keepEditorSelection(event: MouseEvent<HTMLElement> | PointerEvent<HTMLElement>) {
  if ("button" in event && event.button !== 0) return;
  event.preventDefault();
}

function activateOnKeyboard(
  event: KeyboardEvent<HTMLElement>,
  action: () => void,
) {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  action();
}

function hasLinkInSchema(editor: { schema: { inlineContentSchema: Record<string, unknown> } }) {
  return (
    "link" in editor.schema.inlineContentSchema
    && editor.schema.inlineContentSchema.link === "link"
  );
}

function blockPropsMatch(
  blockProps: Record<string, unknown>,
  expectedProps?: Record<string, boolean | number | string>,
) {
  if (!expectedProps) return true;
  return Object.entries(expectedProps).every(([key, value]) => blockProps[key] === value);
}

function propsToSchemaShape(props?: Record<string, boolean | number | string>) {
  return Object.fromEntries(
    Object.entries(props ?? {}).map(([key, value]) => [key, typeof value]),
  ) as Record<string, "boolean" | "number" | "string">;
}

function buildBlockTypeItems(
  editor: TextActionSnapshotEditor,
  firstSelectedBlock: TextActionBlockSnapshot,
): TextActionBlockTypeItem[] {
  return TEXT_ACTION_BLOCK_TYPE_DEFINITIONS
    .filter((item) => {
      const props = "props" in item ? item.props : undefined;
      return editorHasBlockWithType(
        editor as Parameters<typeof editorHasBlockWithType>[0],
        item.type,
        propsToSchemaShape(props),
      );
    })
    .map((item) => {
      const props = "props" in item ? item.props : undefined;
      return {
        key: item.key,
        label: item.label,
        type: item.type,
        props,
        isSelected:
          firstSelectedBlock.type === item.type
          && blockPropsMatch(firstSelectedBlock.props ?? {}, props),
      };
    });
}

function resolveBlockTypeLabel(items: TextActionBlockTypeItem[]) {
  return items.find((item) => item.isSelected)?.label ?? "Normal Text";
}

function createTextActionMenuSnapshot(editor: TextActionSnapshotEditor): TextActionMenuSnapshot {
  const selection = editor.prosemirrorState.selection;
  const selectedBlocks = editor.getSelection()?.blocks ?? [editor.getTextCursorPosition().block];
  const firstSelectedBlock = selectedBlocks[0];
  const hasInlineContent = selectedBlocks.some((block: { content?: unknown }) => block.content !== undefined);
  const blockTypeItems = buildBlockTypeItems(editor, firstSelectedBlock);
  const activeStyles = editor.getActiveStyles() as Record<string, unknown>;
  const canUseTextColor = textActionHasStringStyle(editor, "textColor");
  const canUseBackgroundColor = textActionHasStringStyle(editor, "backgroundColor");

  return {
    eligible: shouldUseTextActionMenu({
      isEditable: editor.isEditable,
      isTableCellSelection: isTableCellSelection(selection as Parameters<typeof isTableCellSelection>[0]),
      hasInlineContent,
      selectionFrom: selection.from,
      selectionTo: selection.to,
    }),
    currentBlockId: typeof firstSelectedBlock?.id === "string" ? firstSelectedBlock.id : null,
    currentBlockType: typeof firstSelectedBlock?.type === "string" ? firstSelectedBlock.type : null,
    currentBlockTypeLabel: resolveBlockTypeLabel(blockTypeItems),
    blockTypeItems,
    activeStyles: {
      bold: activeStyles.bold === true,
      italic: activeStyles.italic === true,
      underline: activeStyles.underline === true,
      strike: activeStyles.strike === true,
      code: activeStyles.code === true,
    },
    textColor: typeof activeStyles.textColor === "string" ? activeStyles.textColor : "default",
    backgroundColor: typeof activeStyles.backgroundColor === "string" ? activeStyles.backgroundColor : "default",
    canUseTextColor,
    canUseBackgroundColor,
    canClearFormat: TEXT_ACTION_BASIC_STYLES.some((style) => textActionHasBooleanStyle(editor, style))
      || canUseTextColor
      || canUseBackgroundColor
      || hasLinkInSchema(editor),
  };
}

function selectCurrentBlocks(editor: TextActionSnapshotEditor) {
  return editor.getSelection()?.blocks ?? [editor.getTextCursorPosition().block];
}

function TextActionDivider({ compact = false }: { compact?: boolean }) {
  return (
    <div className={cn("mx-2 h-px bg-token-menu-border", compact ? "my-0" : "my-1")} />
  );
}

interface TextActionButtonProps
  extends Omit<ComponentPropsWithoutRef<"div">, "children" | "className" | "onMouseDown"> {
  children: ReactNode;
  className?: string;
  label?: string;
  selected?: boolean;
  disabled?: boolean;
  hasPopup?: "dialog" | "menu";
  expanded?: boolean;
  dataPopupOrigin?: boolean;
  onMouseDown?: (event: MouseEvent<HTMLDivElement>) => void;
  onActivate?: () => void;
}

const TextActionButton = forwardRef<HTMLDivElement, TextActionButtonProps>(function TextActionButton({
  children,
  className,
  label,
  selected,
  disabled = false,
  hasPopup,
  expanded,
  dataPopupOrigin = true,
  onMouseDown = keepEditorSelection,
  onActivate,
  onClick,
  onKeyDown,
  ...props
}, ref) {
  return (
    <div
      {...props}
      ref={ref}
      role="button"
      tabIndex={props.tabIndex ?? 0}
      aria-label={label}
      aria-pressed={selected === undefined ? undefined : selected}
      aria-disabled={disabled || undefined}
      aria-haspopup={hasPopup}
      aria-expanded={hasPopup ? Boolean(expanded) : undefined}
      data-popup-origin={dataPopupOrigin ? "true" : undefined}
      contentEditable={false}
      className={cn(
        "inline-flex h-7 w-8 shrink-0 select-none items-center justify-center rounded-[6px] p-1.5 text-token-foreground outline-hidden",
        "focus-visible:ring-1 focus-visible:ring-token-focus-border",
        !disabled && "cursor-interaction hover:bg-token-list-hover-background focus:bg-token-list-hover-background",
        selected === true && "bg-token-foreground/10",
        disabled && "cursor-default opacity-40",
        className,
      )}
      onMouseDown={onMouseDown}
      onClick={(event) => {
        event.stopPropagation();
        if (disabled) return;
        if (onActivate) {
          onActivate();
          return;
        }
        onClick?.(event);
      }}
      onKeyDown={(event) => {
        if (disabled) return;
        if (onActivate) {
          activateOnKeyboard(event, onActivate);
          return;
        }
        onKeyDown?.(event);
      }}
    >
      {children}
    </div>
  );
});

function TextActionButtonTooltip({
  children,
  label,
}: {
  children: ReactNode;
  label: ReactNode;
}) {
  return (
    <NodexTooltip tooltipContent={label} side="top" delayDuration={0}>
      {children}
    </NodexTooltip>
  );
}

function isTextActionLabelOverflowing(element: HTMLElement | null): boolean {
  if (!element) return false;
  return element.scrollWidth - element.clientWidth > 1;
}

function TextActionMenuContent({
  children,
  className,
  side = "right",
  align = "start",
}: {
  children: ReactNode;
  className?: string;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
}) {
  return (
    <DropdownMenuPrimitive.Portal>
      <NodexDropdownContent
        side={side}
        align={align}
        sideOffset={8}
        collisionPadding={8}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
        }}
        className={cn(
          "w-[192px] bg-token-dropdown-background px-1 py-1 text-[14px] backdrop-blur-xl",
          className,
        )}
      >
        {children}
      </NodexDropdownContent>
    </DropdownMenuPrimitive.Portal>
  );
}

function BlockTypeIcon({ item }: { item: TextActionBlockTypeItem | null }) {
  if (!item) return <TextActionNormalTextIcon />;

  if (item.key === "paragraph") return <TextActionNormalTextIcon />;
  if (item.key === "heading-1" || item.key === "toggle-heading-1") {
    return <TextActionHeadingBlockIcon level={1} />;
  }
  if (item.key === "heading-2") return <TextActionHeadingBlockIcon level={2} />;
  if (item.key === "heading-3") return <TextActionHeadingBlockIcon level={3} />;
  if (item.key === "quote") return <TextActionQuoteBlockIcon />;
  if (item.key === "bullet-list") return <TextActionBulletedListBlockIcon />;
  if (item.key === "numbered-list") return <TextActionNumberedListBlockIcon />;
  if (item.key === "todo-list") return <TextActionCheckListBlockIcon />;
  if (item.key === "toggle-list") return <TextActionToggleListBlockIcon />;
  if (item.key === "code") return <TextActionCodeIcon />;

  return <TextActionNormalTextIcon />;
}

function normalizeTextActionColor(color: string): TextActionColorValue {
  return TEXT_ACTION_COLOR_VALUES.includes(color as TextActionColorValue)
    ? color as TextActionColorValue
    : "default";
}

function TextActionColorGlyph({
  color,
  kind,
  size,
  selected = false,
  textColor,
}: {
  color: TextActionColorValue;
  kind: TextActionRecentColorKind;
  size: "trigger" | "menu";
  selected?: boolean;
  textColor?: TextActionColorValue;
}) {
  const isBackground = kind === "background";
  const isDefault = color === "default";
  const shouldShowTextGlyph = kind === "text" || textColor !== undefined;
  const glyphColor = textColor ?? color;
  const borderWidth = selected || isDefault ? 2 : 1;
  const selectedBorderColor = isDefault
    ? "var(--border-strong)"
    : TEXT_ACTION_COLOR_STYLES[color];
  const swatchStyle: CSSProperties = {
    backgroundColor: isBackground
      ? TEXT_ACTION_BACKGROUND_COLOR_STYLES[color]
      : "transparent",
    color: glyphColor === "default"
      ? "var(--color-token-foreground)"
      : TEXT_ACTION_COLOR_STYLES[glyphColor],
    boxShadow: `inset 0 0 0 ${borderWidth}px ${selected ? selectedBorderColor : TEXT_ACTION_COLOR_BORDER_STYLES[color]}`,
  };

  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center rounded-[6px] text-center leading-none font-medium",
        size === "trigger" ? "size-5 text-[12px]" : "size-[26px] text-[16px]",
      )}
      style={swatchStyle}
    >
      {shouldShowTextGlyph ? "A" : null}
    </span>
  );
}

function TextActionColorTriggerGlyph({
  textColor,
  backgroundColor,
}: {
  textColor: string;
  backgroundColor: string;
}) {
  const normalizedTextColor = normalizeTextActionColor(textColor);
  const normalizedBackgroundColor = normalizeTextActionColor(backgroundColor);

  if (normalizedBackgroundColor !== "default") {
    return (
      <TextActionColorGlyph
        kind="background"
        color={normalizedBackgroundColor}
        size="trigger"
        textColor={normalizedTextColor}
      />
    );
  }

  return (
    <TextActionColorGlyph
      kind="text"
      color={normalizedTextColor}
      size="trigger"
    />
  );
}

function TextActionColorSection({
  label,
  children,
  padBottom = false,
}: {
  label: string;
  children: ReactNode;
  padBottom?: boolean;
}) {
  return (
    <div className="block">
      <div className="flex h-7 items-center px-2 text-[12px] text-token-text-secondary">
        <span className="min-w-0 flex-1 truncate">{label}</span>
      </div>
      <div className={cn("grid grid-cols-5 gap-1 px-2", padBottom && "pb-2")}>
        {children}
      </div>
    </div>
  );
}

function TextActionColorSwatchItem({
  kind,
  color,
  ariaLabel,
  selected,
  disabled = false,
  onSelect,
}: {
  kind: TextActionRecentColorKind;
  color: TextActionColorValue;
  ariaLabel: string;
  selected: boolean;
  disabled?: boolean;
  onSelect: () => void;
}) {
  return (
    <div data-popup-origin="true">
      <div className="inline-block w-[30px] p-0 leading-none">
        <div
          role="menuitem"
          tabIndex={-1}
          aria-label={ariaLabel}
          aria-current={selected ? "true" : undefined}
          aria-disabled={disabled || undefined}
          contentEditable={false}
          className={cn(
            "inline-block size-full rounded-[6px] p-0.5 outline-hidden",
            disabled
              ? "cursor-default opacity-45"
              : "cursor-interaction hover:bg-token-list-hover-background focus:bg-token-list-hover-background",
          )}
          onMouseDown={keepEditorSelection}
          onClick={(event) => {
            event.stopPropagation();
            if (disabled) return;
            onSelect();
          }}
          onKeyDown={(event) => {
            if (disabled) return;
            activateOnKeyboard(event, onSelect);
          }}
        >
          <span className="flex min-h-[26px] items-center justify-center">
            <TextActionColorGlyph
              kind={kind}
              color={color}
              size="menu"
              selected={selected}
            />
          </span>
        </div>
      </div>
    </div>
  );
}

function TextActionColorMenu({
  canUseTextColor,
  canUseBackgroundColor,
  textColor,
  backgroundColor,
  onSetTextColor,
  onSetBackgroundColor,
}: Pick<
  NfmTextActionMenuSurfaceProps,
  | "canUseTextColor"
  | "canUseBackgroundColor"
  | "textColor"
  | "backgroundColor"
  | "onSetTextColor"
  | "onSetBackgroundColor"
>) {
  const [open, setOpen] = useState(false);
  const [recentColors, setRecentColors] = useState<TextActionRecentColor[]>(() => readTextActionRecentColors());
  const normalizedTextColor = normalizeTextActionColor(textColor);
  const normalizedBackgroundColor = normalizeTextActionColor(backgroundColor);
  const canUseAnyColor = canUseTextColor || canUseBackgroundColor;

  const applyColor = (kind: TextActionRecentColorKind, color: TextActionColorValue) => {
    const currentColor = kind === "text" ? normalizedTextColor : normalizedBackgroundColor;
    const nextColor: TextActionColorValue = currentColor === color ? "default" : color;

    if (kind === "text") {
      if (!canUseTextColor) return;
      onSetTextColor(nextColor);
    } else {
      if (!canUseBackgroundColor) return;
      onSetBackgroundColor(nextColor);
    }

    const nextRecentColors = recordTextActionRecentColors(kind, nextColor);
    if (nextRecentColors) {
      setRecentColors(nextRecentColors);
    }
  };

  if (!canUseAnyColor) {
    return (
      <TextActionButtonTooltip label="Color">
        <TextActionButton label="Color" disabled hasPopup="dialog">
          <TextActionColorTriggerGlyph
            textColor={textColor}
            backgroundColor={backgroundColor}
          />
        </TextActionButton>
      </TextActionButtonTooltip>
    );
  }

  return (
    <DropdownMenuPrimitive.Root modal={false} open={open} onOpenChange={setOpen}>
      <TextActionButtonTooltip label="Color">
        <DropdownMenuPrimitive.Trigger asChild>
          <TextActionButton label="Color" hasPopup="dialog" expanded={open}>
            <TextActionColorTriggerGlyph
              textColor={textColor}
              backgroundColor={backgroundColor}
            />
          </TextActionButton>
        </DropdownMenuPrimitive.Trigger>
      </TextActionButtonTooltip>
      <DropdownMenuPrimitive.Portal>
        <NodexDropdownContent
          role="dialog"
          aria-modal="true"
          aria-label="Color"
          side="top"
          align="start"
          sideOffset={4}
          collisionPadding={12}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
          }}
          style={{
            width: "190px",
            minWidth: "180px",
            maxWidth: "calc(100vw - 24px)",
            maxHeight: "70vh",
            transformOrigin: "0% bottom",
          }}
          className="!overflow-hidden !rounded-[14px] !bg-token-dropdown-background !p-0 text-[14px] !shadow-xl-spread !backdrop-blur-xl"
        >
          <div className="notion-scroller vertical max-h-[70vh] overflow-y-auto">
            <div role="menu" tabIndex={0} aria-label="Color options">
              <TextActionColorSection label="Recently used">
                {recentColors.map((recentColor) => {
                  const recentLabel = TEXT_ACTION_COLOR_LABELS[recentColor.color];
                  const recentAriaLabel = `Recently used: ${recentLabel} ${recentColor.kind === "background" ? "background" : "text"}`;
                  const canUseRecentColor = recentColor.kind === "text" ? canUseTextColor : canUseBackgroundColor;
                  const recentSelected = recentColor.kind === "text"
                    ? normalizedTextColor === recentColor.color
                    : normalizedBackgroundColor === recentColor.color;

                  return (
                    <TextActionColorSwatchItem
                      key={`recent-${recentColor.kind}-${recentColor.color}`}
                      kind={recentColor.kind}
                      color={recentColor.color}
                      ariaLabel={recentAriaLabel}
                      selected={recentSelected}
                      disabled={!canUseRecentColor}
                      onSelect={() => applyColor(recentColor.kind, recentColor.color)}
                    />
                  );
                })}
              </TextActionColorSection>

              {canUseTextColor ? (
                <TextActionColorSection label="Text color">
                  {TEXT_ACTION_NOTION_COLOR_ORDER.map((color) => (
                    <TextActionColorSwatchItem
                      key={`text-${color}`}
                      kind="text"
                      color={color}
                      ariaLabel={`Text color: ${TEXT_ACTION_COLOR_LABELS[color]}`}
                      selected={normalizedTextColor === color}
                      onSelect={() => applyColor("text", color)}
                    />
                  ))}
                </TextActionColorSection>
              ) : null}

              {canUseBackgroundColor ? (
                <TextActionColorSection label="Background color" padBottom>
                  {TEXT_ACTION_NOTION_COLOR_ORDER.map((color) => (
                    <TextActionColorSwatchItem
                      key={`background-${color}`}
                      kind="background"
                      color={color}
                      ariaLabel={`Background color: ${TEXT_ACTION_COLOR_LABELS[color]}`}
                      selected={normalizedBackgroundColor === color}
                      onSelect={() => applyColor("background", color)}
                    />
                  ))}
                </TextActionColorSection>
              ) : null}
            </div>
          </div>
        </NodexDropdownContent>
      </DropdownMenuPrimitive.Portal>
    </DropdownMenuPrimitive.Root>
  );
}

function TextActionBlockTypeMenu({
  currentBlockTypeLabel,
  blockTypeItems,
  onSelectBlockType,
}: Pick<
  NfmTextActionMenuSurfaceProps,
  "currentBlockTypeLabel" | "blockTypeItems" | "onSelectBlockType"
>) {
  const currentBlockTypeItem = blockTypeItems.find((item) => item.isSelected)
    ?? blockTypeItems.find((item) => item.label === currentBlockTypeLabel)
    ?? null;

  return (
    <DropdownMenuPrimitive.Root modal={false}>
      <TextActionButtonTooltip label="Change block type">
        <DropdownMenuPrimitive.Trigger asChild>
          <div
            role="button"
            tabIndex={0}
            aria-haspopup="dialog"
            aria-expanded={false}
            data-popup-origin="true"
            contentEditable={false}
            className="flex h-7 select-none items-center gap-2 rounded-[6px] px-1.5 text-token-foreground outline-hidden hover:bg-token-list-hover-background focus:bg-token-list-hover-background focus-visible:ring-1 focus-visible:ring-token-focus-border"
            onMouseDown={keepEditorSelection}
          >
            <span className="flex size-5 shrink-0 items-center justify-center text-token-text-secondary">
              <BlockTypeIcon item={currentBlockTypeItem} />
            </span>
            <span className="min-w-0 flex-1 truncate text-left">{currentBlockTypeLabel}</span>
            <ChevronRightIcon className="size-4 shrink-0 text-token-text-secondary" />
          </div>
        </DropdownMenuPrimitive.Trigger>
      </TextActionButtonTooltip>
      <TextActionMenuContent>
        {blockTypeItems.map((item) => (
          <NodexDropdownItem
            key={item.key}
            leftSlot={<span className="text-token-description-foreground"><BlockTypeIcon item={item} /></span>}
            rightSlot={item.isSelected ? <CheckmarkIcon className="size-4" /> : null}
            onPointerDownCapture={keepEditorSelection}
            onSelect={() => onSelectBlockType(item)}
          >
            {item.label}
          </NodexDropdownItem>
        ))}
      </TextActionMenuContent>
    </DropdownMenuPrimitive.Root>
  );
}

function TextActionDisabledButton({
  children,
  label,
  className,
}: {
  children: ReactNode;
  label: string;
  className?: string;
}) {
  return (
    <NodexTooltip tooltipContent={`${label} is not supported in Nodex yet.`} side="top" delayDuration={0}>
      <TextActionButton label={label} disabled className={className}>
        {children}
      </TextActionButton>
    </NodexTooltip>
  );
}

function renderCreateLinkTrigger(props: NfmCreateLinkTriggerProps) {
  return (
    <TextActionButton
      label={props.ariaLabel}
      hasPopup="dialog"
      expanded={props.open}
      onMouseDown={props.onMouseDown}
      onActivate={props.onClick}
    >
      <TextActionLinkIcon />
    </TextActionButton>
  );
}

function TextActionMoreMenu({
  canConvertDividerToThreadSection,
  onConvertDividerToThreadSection,
}: Pick<
  NfmTextActionMenuSurfaceProps,
  "canConvertDividerToThreadSection" | "onConvertDividerToThreadSection"
>) {
  return (
    <DropdownMenuPrimitive.Root modal={false}>
      <TextActionButtonTooltip label="More">
        <DropdownMenuPrimitive.Trigger asChild>
          <TextActionButton label="More" hasPopup="menu" className="notion-block-action-menu">
            <TextActionEllipsisIcon />
          </TextActionButton>
        </DropdownMenuPrimitive.Trigger>
      </TextActionButtonTooltip>
      <TextActionMenuContent>
        {canConvertDividerToThreadSection ? (
          <NodexDropdownItem
            onPointerDownCapture={keepEditorSelection}
            onSelect={onConvertDividerToThreadSection}
          >
            Make thread section
          </NodexDropdownItem>
        ) : null}
        <NodexDropdownItem disabled>
          Block actions
        </NodexDropdownItem>
        <NodexDropdownItem disabled>
          Move to
        </NodexDropdownItem>
        <NodexDropdownItem disabled>
          Duplicate
        </NodexDropdownItem>
      </TextActionMenuContent>
    </DropdownMenuPrimitive.Root>
  );
}

function TextActionSkillRow({
  label,
  disabled = true,
  onClick,
}: {
  label: string;
  disabled?: boolean;
  onClick?: () => void;
}) {
  const labelRef = useRef<HTMLSpanElement>(null);
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const [labelOverflowing, setLabelOverflowing] = useState(false);

  const openTooltipIfOverflowing = () => {
    const nextLabelOverflowing = isTextActionLabelOverflowing(labelRef.current);
    setLabelOverflowing(nextLabelOverflowing);
    setTooltipOpen(nextLabelOverflowing);
  };

  const closeTooltip = () => {
    setTooltipOpen(false);
  };

  const row = (
    <div
      role="button"
      tabIndex={0}
      aria-disabled={disabled || undefined}
      contentEditable={false}
      className={cn(
        "group flex h-7 select-none items-center justify-start gap-1.5 rounded-[6px] px-2 whitespace-nowrap outline-hidden",
        disabled
          ? "cursor-default text-token-text-secondary opacity-55"
          : "cursor-interaction text-token-foreground hover:bg-token-list-hover-background focus:bg-token-list-hover-background",
      )}
      onPointerEnter={openTooltipIfOverflowing}
      onPointerLeave={closeTooltip}
      onFocus={openTooltipIfOverflowing}
      onBlur={closeTooltip}
      onMouseDown={keepEditorSelection}
      onClick={() => {
        if (disabled) return;
        onClick?.();
      }}
      onKeyDown={(event) => {
        if (disabled || !onClick) return;
        activateOnKeyboard(event, onClick);
      }}
    >
      <span ref={labelRef} className="min-w-0 flex-1 truncate">{label}</span>
      {disabled ? (
        <span
          role="button"
          tabIndex={-1}
          aria-label="Edit skill"
          aria-disabled="true"
          className="ml-auto shrink-0 opacity-0 transition-opacity duration-100 group-hover:opacity-40 group-focus:opacity-40"
        >
          <TextActionPencilSmallIcon className="size-4 text-token-text-secondary" />
        </span>
      ) : null}
    </div>
  );

  return (
    <NodexTooltip
      tooltipContent={label}
      side="top"
      delayDuration={0}
      open={tooltipOpen && labelOverflowing}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          closeTooltip();
          return;
        }

        openTooltipIfOverflowing();
      }}
    >
      {row}
    </NodexTooltip>
  );
}

function TextActionAiPane({
  nodexRows,
  onNodexRow,
}: Pick<NfmTextActionMenuSurfaceProps, "nodexRows" | "onNodexRow">) {
  return (
    <div className="relative">
      <div className="max-h-[134px] overflow-y-auto py-1">
        {nodexRows.length > 0 ? (
          <>
            <div className="flex h-7 items-center px-2 text-[12px] text-token-text-secondary">
              Actions
            </div>
            {nodexRows.map((row) => (
              <TextActionSkillRow
                key={row.key}
                label={row.label}
                disabled={!row.enabled}
                onClick={() => onNodexRow(row)}
              />
            ))}
          </>
        ) : null}
        <div className="flex h-7 items-center px-2 text-[12px] text-token-text-secondary">
          <span className="min-w-0 flex-1 truncate">Skills</span>
          <TextActionDisabledButton label="Skills" className="size-7 text-token-text-secondary">
            <TextActionSlidersIcon />
          </TextActionDisabledButton>
        </div>
        {TEXT_ACTION_REFERENCE_SKILLS.map((skill) => (
          <TextActionSkillRow key={skill.key} label={skill.label} disabled />
        ))}
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-linear-to-b from-transparent to-token-dropdown-background" />
    </div>
  );
}

function TextActionAiFooter() {
  return (
    <div
      className="flex min-h-8 items-center gap-1.5 rounded-[6px] border border-token-border px-2 py-1.5 text-[14px] leading-[1.4] text-token-text-secondary"
      contentEditable={false}
    >
      <div
        role="textbox"
        aria-multiline="true"
        aria-disabled="true"
        contentEditable={false}
        spellCheck={true}
        data-content-editable-leaf="true"
        className="min-h-[1em] min-w-0 flex-1 truncate text-token-description-foreground"
      >
        Edit with AI
      </div>
      <span className="shrink-0 text-[12px] leading-4 text-token-description-foreground">⌘⌃E</span>
    </div>
  );
}

export function NfmTextActionMenuSurface({
  currentBlockTypeLabel,
  blockTypeItems,
  activeStyles,
  textColor,
  backgroundColor,
  canUseTextColor,
  canUseBackgroundColor,
  canClearFormat,
  linkControl,
  nodexRows,
  canConvertDividerToThreadSection,
  onSelectBlockType,
  onToggleStyle,
  onSetTextColor,
  onSetBackgroundColor,
  onClearFormat,
  onNodexRow,
  onConvertDividerToThreadSection,
}: NfmTextActionMenuSurfaceProps) {
  return (
    <div className="pointer-events-none p-4" contentEditable={false}>
      <div
        className="pointer-events-auto flex w-[192px] flex-col items-stretch overflow-hidden rounded-[14px] bg-token-dropdown-background p-2 text-[14px] leading-[1.2] text-token-foreground shadow-xl-spread ring-[0.5px] ring-token-border backdrop-blur-xl"
        role="toolbar"
        aria-label="Text actions"
      >
        <TextActionBlockTypeMenu
          currentBlockTypeLabel={currentBlockTypeLabel}
          blockTypeItems={blockTypeItems}
          onSelectBlockType={onSelectBlockType}
        />
        <TextActionDivider />

        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1">
            <TextActionColorMenu
              canUseTextColor={canUseTextColor}
              canUseBackgroundColor={canUseBackgroundColor}
              textColor={textColor}
              backgroundColor={backgroundColor}
              onSetTextColor={onSetTextColor}
              onSetBackgroundColor={onSetBackgroundColor}
            />
            <TextActionButtonTooltip label={TEXT_ACTION_STYLE_LABELS.bold}>
              <TextActionButton
                label={TEXT_ACTION_STYLE_LABELS.bold}
                selected={activeStyles.bold}
                onActivate={() => onToggleStyle("bold")}
              >
                <TextActionBoldIcon />
              </TextActionButton>
            </TextActionButtonTooltip>
            <TextActionButtonTooltip label={TEXT_ACTION_STYLE_LABELS.italic}>
              <TextActionButton
                label={TEXT_ACTION_STYLE_LABELS.italic}
                selected={activeStyles.italic}
                onActivate={() => onToggleStyle("italic")}
              >
                <TextActionItalicIcon />
              </TextActionButton>
            </TextActionButtonTooltip>
            <TextActionButtonTooltip label={TEXT_ACTION_STYLE_LABELS.underline}>
              <TextActionButton
                label={TEXT_ACTION_STYLE_LABELS.underline}
                selected={activeStyles.underline}
                onActivate={() => onToggleStyle("underline")}
              >
                <TextActionUnderlineIcon />
              </TextActionButton>
            </TextActionButtonTooltip>
            <TextActionButtonTooltip label="Clear format">
              <TextActionButton
                label="Clear format"
                className="w-7"
                disabled={!canClearFormat}
                onActivate={onClearFormat}
              >
                <TextActionClearFormatIcon />
              </TextActionButton>
            </TextActionButtonTooltip>
          </div>
          <div className="flex items-center gap-1">
            {linkControl ?? (
              <TextActionDisabledButton label="Link">
                <TextActionLinkIcon />
              </TextActionDisabledButton>
            )}
            <TextActionButtonTooltip label={TEXT_ACTION_STYLE_LABELS.strike}>
              <TextActionButton
                label={TEXT_ACTION_STYLE_LABELS.strike}
                selected={activeStyles.strike}
                onActivate={() => onToggleStyle("strike")}
              >
                <TextActionStrikeIcon />
              </TextActionButton>
            </TextActionButtonTooltip>
            <TextActionButtonTooltip label={TEXT_ACTION_STYLE_LABELS.code}>
              <TextActionButton
                label={TEXT_ACTION_STYLE_LABELS.code}
                selected={activeStyles.code}
                onActivate={() => onToggleStyle("code")}
              >
                <TextActionCodeIcon />
              </TextActionButton>
            </TextActionButtonTooltip>
            <TextActionDisabledButton label="Equation">
              <TextActionEquationIcon />
            </TextActionDisabledButton>
            <TextActionMoreMenu
              canConvertDividerToThreadSection={canConvertDividerToThreadSection}
              onConvertDividerToThreadSection={onConvertDividerToThreadSection}
            />
          </div>
        </div>

        <TextActionDivider />
        <div className="flex items-center">
          <TextActionDisabledButton label="Write a comment" className="min-w-0 flex-1 justify-start gap-2 px-1.5">
            <TextActionCommentIcon />
            <span className="truncate">Comment</span>
          </TextActionDisabledButton>
          <TextActionDisabledButton label="Reaction">
            <TextActionReactionIcon />
          </TextActionDisabledButton>
          <TextActionDisabledButton label="Comment pencil">
            <TextActionCommentPencilIcon />
          </TextActionDisabledButton>
        </div>
        <TextActionDivider compact />

        <TextActionAiPane nodexRows={nodexRows} onNodexRow={onNodexRow} />
        <TextActionAiFooter />
      </div>
    </div>
  );
}

export function NfmTextActionMenu({ fallback }: { fallback: ReactNode }) {
  const editor = useBlockNoteEditor();
  const runtime = useNfmTextActionMenuRuntime();
  const snapshot = useEditorState({
    editor,
    selector: ({ editor }) => createTextActionMenuSnapshot(
      editor as unknown as TextActionSnapshotEditor,
    ),
  });

  const nodexRows = useMemo(
    () => resolveNodexTextActionRows({
      currentBlockId: snapshot.currentBlockId,
      currentBlockType: snapshot.currentBlockType,
      canSendBlocks: runtime.canSendBlocks && Boolean(runtime.onSendBlocks),
      hasSendThreadSection: Boolean(runtime.onSendThreadSection),
      hasConvertDividerToThreadSection: Boolean(runtime.onConvertDividerToThreadSection),
    }),
    [
      runtime.canSendBlocks,
      runtime.onConvertDividerToThreadSection,
      runtime.onSendBlocks,
      runtime.onSendThreadSection,
      snapshot.currentBlockId,
      snapshot.currentBlockType,
    ],
  );

  if (!snapshot.eligible) {
    return <>{fallback}</>;
  }

  const selectBlockType = (item: TextActionBlockTypeItem) => {
    const selectedBlocks = selectCurrentBlocks(
      editor as unknown as TextActionSnapshotEditor,
    );

    applyTextActionBlockType(
      editor as TextActionEditorAdapter,
      selectedBlocks,
      item as TextActionBlockTypeUpdate,
    );
  };

  const toggleStyle = (style: TextActionBasicStyle) => {
    applyTextActionToggleStyle(editor as TextActionEditorAdapter, style);
  };

  const setTextColor = (color: TextActionColorValue) => {
    applyTextActionStringStyle(
      editor as TextActionEditorAdapter,
      "textColor",
      color,
      snapshot.canUseTextColor,
      () => undefined,
    );
  };

  const setBackgroundColor = (color: TextActionColorValue) => {
    applyTextActionStringStyle(
      editor as TextActionEditorAdapter,
      "backgroundColor",
      color,
      snapshot.canUseBackgroundColor,
      () => undefined,
    );
  };

  const clearFormat = () => {
    applyTextActionClearFormat(
      editor as TextActionEditorAdapter,
      TEXT_ACTION_BASIC_STYLES,
      {
        canUseTextColor: snapshot.canUseTextColor,
        canUseBackgroundColor: snapshot.canUseBackgroundColor,
      },
    );
  };

  const handleNodexRow = (row: TextActionNodexRow) => {
    if (!snapshot.currentBlockId) return;

    if (row.key === "send-section-to-codex") {
      runtime.onSendThreadSection?.(snapshot.currentBlockId);
      return;
    }

    if (row.key === "convert-divider-to-thread-section") {
      runtime.onConvertDividerToThreadSection?.(snapshot.currentBlockId);
      return;
    }

    if (row.mode) {
      runtime.onSendBlocks?.(row.mode as SendBlocksMode, snapshot.currentBlockId);
    }
  };

  const handleConvertDivider = () => {
    if (!snapshot.currentBlockId) return;
    runtime.onConvertDividerToThreadSection?.(snapshot.currentBlockId);
  };

  return (
    <NfmTextActionMenuSurface
      currentBlockTypeLabel={snapshot.currentBlockTypeLabel}
      blockTypeItems={snapshot.blockTypeItems}
      activeStyles={snapshot.activeStyles}
      textColor={snapshot.textColor}
      backgroundColor={snapshot.backgroundColor}
      canUseTextColor={snapshot.canUseTextColor}
      canUseBackgroundColor={snapshot.canUseBackgroundColor}
      canClearFormat={snapshot.canClearFormat}
      linkControl={<NfmCreateLinkButton renderTrigger={renderCreateLinkTrigger} />}
      nodexRows={nodexRows}
      canConvertDividerToThreadSection={
        snapshot.currentBlockType === "divider"
        && Boolean(runtime.onConvertDividerToThreadSection)
      }
      onSelectBlockType={selectBlockType}
      onToggleStyle={toggleStyle}
      onSetTextColor={setTextColor}
      onSetBackgroundColor={setBackgroundColor}
      onClearFormat={clearFormat}
      onNodexRow={handleNodexRow}
      onConvertDividerToThreadSection={handleConvertDivider}
    />
  );
}
