import { Fragment, forwardRef, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine";
import {
  draggable,
  dropTargetForElements,
} from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { preserveOffsetOnSource } from "@atlaskit/pragmatic-drag-and-drop/element/preserve-offset-on-source";
import { setCustomNativeDragPreview } from "@atlaskit/pragmatic-drag-and-drop/element/set-custom-native-drag-preview";
import type { CardPropertyPosition } from "@/lib/card-property-position";
import type { DbViewDisplayPrefs, DbViewDisplayPropertyKey } from "../../lib/db-view-prefs";
import { resolveKanbanPriorityOption } from "../../lib/kanban-options";
import { EMPTY_DISPLAY_VALUE_TOKEN, getMetaChipClassName } from "../../lib/toggle-list/meta-chips";
import { estimateStyles } from "@/lib/types";
import type { DatabasePageSummary, Priority } from "@/lib/types";
import { useCardPropertyPosition } from "./card-deps";
import { useTheme } from "@/lib/use-theme";
import { cn } from "@/lib/utils";
import { mergePageDraftOverlay, usePageDraftOverlay } from "../../lib/page-draft-store";
import { ChipPropertyEditor } from "./editor/chip-property-editor";
import { CardContextMenu } from "./card-context-menu";
import {
  buildKanbanCardDropTargetData,
  canDropOnKanbanCard,
  isKanbanCardDragData,
  type KanbanCardDragData,
} from "./pragmatic-drag-data";

type CardEditableProperty = "priority" | "estimate";
type CardPropertyBadgeLayout = "stacked" | "inline";
type KanbanCardDisplayProperty = Extract<DbViewDisplayPropertyKey, "priority" | "estimate" | "tags" | "assignee">;
type CardType = DatabasePageSummary;

const DEFAULT_KANBAN_CARD_DISPLAY_ORDER: KanbanCardDisplayProperty[] = [
  "priority",
  "estimate",
  "tags",
  "assignee",
];
const TAG_CHIP_CLASS_NAME =
  "inline-flex h-4.5 items-center rounded-sm bg-(--gray-bg) px-1.5 text-xs/snug-plus text-(--foreground-secondary)";
const EMPTY_VALUE_CHIP_CLASS_NAME = getMetaChipClassName(EMPTY_DISPLAY_VALUE_TOKEN);

export interface CardPropertyUpdateInput {
  pageId: string;
  columnId: string;
  property: CardEditableProperty;
  value: string;
}

interface CardProps {
  projectId?: string;
  card: CardType;
  columnId: string;
  displayPrefs?: DbViewDisplayPrefs;
  dragInstanceId?: symbol;
  dragDisabled?: boolean;
  dropDisabled?: boolean;
  isFocused?: boolean;
  isActiveInPanel?: boolean;
  isSelected?: boolean;
  onClick: (event: React.MouseEvent<HTMLDivElement>) => void;
  onDoubleClick?: (event: React.MouseEvent<HTMLDivElement>) => void;
  buildDragData?: (card: CardType, columnId: string) => KanbanCardDragData;
  onUpdateProperty?: (input: CardPropertyUpdateInput) => Promise<void> | void;
  contextMenu?: {
    currentColumnId: string;
    currentProjectId: string;
    currentProjectName: string;
    onDelete: (input: { pageId: string; columnId: string }) => Promise<void> | void;
    onCopyLink: (input: { pageId: string; projectId: string }) => Promise<void> | void;
    onMenuOpen?: () => void;
  };
}

interface CardBodyProps {
  card: CardType;
  columnId: string;
  displayPrefs?: DbViewDisplayPrefs;
  position: CardPropertyPosition;
  activeProperty: CardEditableProperty | null;
  onOpenPropertyEditor?: (
    property: CardEditableProperty,
    currentToken: string,
    event: React.MouseEvent<HTMLButtonElement>,
  ) => void;
  onChipPointerDown?: (event: React.PointerEvent<HTMLButtonElement>) => void;
}

const PRIORITY_TOKEN_BY_VALUE: Record<Priority, string> = {
  "p0-critical": "P0",
  "p1-high": "P1",
  "p2-medium": "P2",
  "p3-low": "P3",
  "p4-later": "P4",
};

function CardPropertyBadges({
  card,
  columnId,
  displayPrefs,
  layout = "stacked",
  className,
  activeProperty,
  onOpenPropertyEditor,
  onChipPointerDown,
}: {
  card: CardType;
  columnId: string;
  displayPrefs?: DbViewDisplayPrefs;
  layout?: CardPropertyBadgeLayout;
  className?: string;
  activeProperty: CardEditableProperty | null;
  onOpenPropertyEditor?: (
    property: CardEditableProperty,
    currentToken: string,
    event: React.MouseEvent<HTMLButtonElement>,
  ) => void;
  onChipPointerDown?: (event: React.PointerEvent<HTMLButtonElement>) => void;
}) {
  const priorityOption = resolveKanbanPriorityOption(card.priority);
  const priorityLabel = priorityOption?.label.split(" - ")[0] ?? priorityOption?.label;
  const estimateToken = card.estimate ? card.estimate.toUpperCase() : "-";
  const chipsAreEditable = typeof onOpenPropertyEditor === "function";
  const assigneeClassName = layout === "inline"
    ? "text-xs text-(--foreground-tertiary)"
    : "ml-auto text-xs text-(--foreground-tertiary)";
  const Container = layout === "inline" ? "span" : "div";
  const propertyOrder = (displayPrefs?.propertyOrder ?? DEFAULT_KANBAN_CARD_DISPLAY_ORDER)
    .filter(
      (property): property is KanbanCardDisplayProperty =>
        DEFAULT_KANBAN_CARD_DISPLAY_ORDER.includes(property as KanbanCardDisplayProperty),
    );
  const hiddenProperties = new Set(
    (displayPrefs?.hiddenProperties ?? [])
      .filter(
        (property): property is KanbanCardDisplayProperty =>
          DEFAULT_KANBAN_CARD_DISPLAY_ORDER.includes(property as KanbanCardDisplayProperty),
      ),
  );
  const showEmptyEstimate = displayPrefs?.showEmptyEstimate ?? false;
  const showEmptyPriority = displayPrefs?.showEmptyPriority ?? false;

  const renderEditableChip = (
    property: CardEditableProperty,
    currentToken: string,
    label: string,
    className: string,
  ) => {
    if (!chipsAreEditable) {
      return (
        <span className={className}>
          {label}
        </span>
      );
    }

    return (
      <button
        type="button"
        data-card-property-trigger={property}
        data-card-property-uuid-v7={card.id}
        data-card-property-column-id={columnId}
        className={cn(
          className,
          "cursor-pointer border-none outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--accent-blue)_55%,transparent)] focus-visible:ring-offset-2 focus-visible:ring-offset-(--card)",
        )}
        aria-label={`Edit ${property}`}
        aria-haspopup="listbox"
        aria-expanded={activeProperty === property}
        onPointerDown={onChipPointerDown}
        onClick={(event) => {
          if (!onOpenPropertyEditor) {
            return;
          }
          onOpenPropertyEditor(property, currentToken, event);
        }}
      >
        {label}
      </button>
    );
  };

  const renderTagChip = (label: string) => (
    <span className={TAG_CHIP_CLASS_NAME}>
      {label}
    </span>
  );

  const renderEmptyValueChip = (property: CardEditableProperty) =>
    renderEditableChip(
      property,
      EMPTY_DISPLAY_VALUE_TOKEN,
      EMPTY_DISPLAY_VALUE_TOKEN,
      EMPTY_VALUE_CHIP_CLASS_NAME,
    );

  const renderProperty = (property: KanbanCardDisplayProperty) => {
    if (hiddenProperties.has(property)) return null;

    if (property === "priority") {
      if (!priorityOption || !card.priority || !priorityLabel) {
        if (!showEmptyPriority) return null;
        return renderEmptyValueChip("priority");
      }
      return renderEditableChip(
        "priority",
        PRIORITY_TOKEN_BY_VALUE[card.priority],
        priorityLabel,
        cn(
          "inline-flex h-4.5 items-center rounded-sm px-1.5 text-xs/snug-plus",
          priorityOption.className,
        ),
      );
    }

    if (property === "estimate") {
      if (!card.estimate) {
        if (!showEmptyEstimate) return null;
        return renderEmptyValueChip("estimate");
      }
      return renderEditableChip(
        "estimate",
        estimateToken,
        estimateStyles[card.estimate].label,
        cn(
          "inline-flex h-4.5 items-center rounded-sm px-1.5 text-xs/snug-plus",
          estimateStyles[card.estimate].className,
        ),
      );
    }

    if (property === "tags") {
      if (card.tags.length === 0) return null;
      return card.tags.map((tag) => (
        <Fragment key={tag}>
          {renderTagChip(tag)}
        </Fragment>
      ));
    }

    if (property === "assignee") {
      if (!card.assignee) return null;
      return (
        <span className={assigneeClassName}>
          @{card.assignee}
        </span>
      );
    }

    return null;
  };

  return (
    <Container
      className={cn(
        layout === "inline"
          ? "mr-1 inline-flex max-w-full flex-wrap items-center gap-x-1.5 gap-y-1 align-middle"
          : "flex flex-wrap items-center gap-x-1.5 gap-y-1",
        className,
      )}
    >
      {propertyOrder.map((property) => (
        <Fragment key={property}>
          {renderProperty(property)}
        </Fragment>
      ))}

    </Container>
  );
}

const CardBody = memo(function CardBody({
  card,
  columnId,
  displayPrefs,
  position,
  activeProperty,
  onOpenPropertyEditor,
  onChipPointerDown,
}: CardBodyProps) {
  const propertiesAtTop = position === "top";
  const propertiesInline = position === "inline";
  const plainDescription = card.descriptionPreview || null;

  return (
    <>
      {propertiesAtTop ? (
        <CardPropertyBadges
          card={card}
          columnId={columnId}
          displayPrefs={displayPrefs}
          layout="stacked"
          className="mx-1.5 pt-2 pb-1"
          activeProperty={activeProperty}
          onOpenPropertyEditor={onOpenPropertyEditor}
          onChipPointerDown={onChipPointerDown}
        />
      ) : null}

      <div className={cn("px-2 pb-1", propertiesAtTop ? "pt-0" : "pt-2")}>
        {propertiesInline ? (
          <h3 className="text-base/normal font-medium wrap-break-word text-(--foreground)">
            <CardPropertyBadges
              card={card}
              columnId={columnId}
              displayPrefs={displayPrefs}
              layout="inline"
              activeProperty={activeProperty}
              onOpenPropertyEditor={onOpenPropertyEditor}
              onChipPointerDown={onChipPointerDown}
            />
            <span className="align-middle">{card.title}</span>
          </h3>
        ) : (
          <h3 className="text-base/normal font-medium wrap-break-word text-(--foreground)">
            {card.title}
          </h3>
        )}
      </div>

      {plainDescription ? (
        <p className="line-clamp-2 px-2 pb-1 text-xs/normal wrap-break-word text-(--foreground-secondary)">
          {plainDescription}
        </p>
      ) : null}

      {position === "bottom" ? (
        <CardPropertyBadges
          card={card}
          columnId={columnId}
          displayPrefs={displayPrefs}
          layout="stacked"
          className="mx-1.5 pb-2"
          activeProperty={activeProperty}
          onOpenPropertyEditor={onOpenPropertyEditor}
          onChipPointerDown={onChipPointerDown}
        />
      ) : null}
    </>
  );
});

interface ResolvedCardBodyProps extends Omit<CardBodyProps, "page"> {
  projectId?: string;
  card: CardType;
}

const ResolvedCardBody = memo(function ResolvedCardBody({
  projectId,
  card,
  columnId,
  displayPrefs,
  position,
  activeProperty,
  onOpenPropertyEditor,
  onChipPointerDown,
}: ResolvedCardBodyProps) {
  const draftOverlay = usePageDraftOverlay(projectId, card.id);
  const resolvedCard = useMemo(
    () => mergePageDraftOverlay(card, draftOverlay) ?? card,
    [card, draftOverlay],
  );

  return (
    <CardBody
      card={resolvedCard}
      columnId={columnId}
      displayPrefs={displayPrefs}
      position={position}
      activeProperty={activeProperty}
      onOpenPropertyEditor={onOpenPropertyEditor}
      onChipPointerDown={onChipPointerDown}
    />
  );
});

interface CardSurfaceProps extends React.HTMLAttributes<HTMLDivElement> {
  projectId?: string;
  card: CardType;
  columnId: string;
  displayPrefs?: DbViewDisplayPrefs;
  dragDisabled?: boolean;
  showStaticDragGhost?: boolean;
  fixedWidth?: number;
  fixedHeight?: number;
  isDragging?: boolean;
  isFocused?: boolean;
  isActiveInPanel?: boolean;
  isSelected?: boolean;
  position: CardPropertyPosition;
  activeProperty: CardEditableProperty | null;
  onOpenPropertyEditor?: (
    property: CardEditableProperty,
    currentToken: string,
    event: React.MouseEvent<HTMLButtonElement>,
  ) => void;
  onChipPointerDown?: (event: React.PointerEvent<HTMLButtonElement>) => void;
}

const CardSurface = forwardRef<HTMLDivElement, CardSurfaceProps>(function CardSurface({
  projectId,
  card,
  columnId,
  displayPrefs,
  dragDisabled = false,
  showStaticDragGhost = false,
  fixedWidth,
  fixedHeight,
  isDragging = false,
  isFocused,
  isActiveInPanel = false,
  isSelected = false,
  position,
  activeProperty,
  onOpenPropertyEditor,
  onChipPointerDown,
  className,
  style,
  ...domProps
}: CardSurfaceProps, ref) {
  const { resolved } = useTheme();
  const isDark = resolved === "dark";
  const ringShadow = isSelected
      ? "0 0 0 1.5px color-mix(in srgb, var(--accent-blue) 72%, transparent)"
      : isActiveInPanel
        ? "0 0 0 1.5px color-mix(in srgb, var(--accent-blue) 58%, transparent)"
        : isFocused
          ? "0 0 0 1.5px color-mix(in srgb, var(--accent-blue) 50%, transparent)"
          : null;

  const baseShadow = isDragging
    ? isDark
      ? "0 8px 16px rgba(0,0,0,0.3)"
      : "0 8px 16px rgba(25,25,25,0.08)"
    : isDark
      ? "0 4px 12px rgba(0,0,0,0.15), 0 1px 2px rgba(0,0,0,0.1), 0 0 0 1px color-mix(in srgb, var(--column-accent, rgba(255,255,255,0.07)) 20%, transparent)"
      : "0 4px 12px rgba(25,25,25,0.027), 0 1px 2px rgba(25,25,25,0.02), 0 0 0 1px color-mix(in srgb, var(--column-accent, rgba(42,28,0,0.07)) 15%, transparent)";

  const mergedStyle: React.CSSProperties = {
    ...style,
    width: fixedWidth,
    minHeight: fixedHeight,
    boxShadow: ringShadow
      ? `${baseShadow}, ${ringShadow}`
      : baseShadow,
  };

  return (
    <div
      ref={ref}
      style={mergedStyle}
      {...domProps}
      data-kanban-card-panel-active={isActiveInPanel ? "true" : undefined}
      className={cn(
        "min-h-10 overflow-hidden rounded-lg bg-(--card) select-none",
        dragDisabled ? "cursor-pointer" : "cursor-grab active:cursor-grabbing",
        "hover:bg-[color-mix(in_srgb,var(--column-accent,#888)_8%,var(--card))]",
        showStaticDragGhost && "opacity-35",
        isDragging && !showStaticDragGhost && "opacity-50",
        isSelected && "bg-[color-mix(in_srgb,var(--accent-blue)_6%,var(--card))]",
        className,
      )}
    >
      <ResolvedCardBody
        projectId={projectId}
        card={card}
        columnId={columnId}
        displayPrefs={displayPrefs}
        position={position}
        activeProperty={activeProperty}
        onOpenPropertyEditor={onOpenPropertyEditor}
        onChipPointerDown={onChipPointerDown}
      />
    </div>
  );
});

export function CardPreview({
  projectId,
  card,
  columnId,
  displayPrefs,
  isSelected = false,
  fixedWidth,
  fixedHeight,
}: Pick<CardProps, "projectId" | "card" | "columnId" | "displayPrefs" | "isSelected"> & {
  fixedWidth?: number;
  fixedHeight?: number;
}) {
  const { position } = useCardPropertyPosition();

  return (
    <CardSurface
      projectId={projectId}
      card={card}
      columnId={columnId}
      displayPrefs={displayPrefs}
      dragDisabled
      isSelected={isSelected}
      fixedWidth={fixedWidth}
      fixedHeight={fixedHeight}
      position={position}
      activeProperty={null}
    />
  );
}

export function Card({
  projectId,
  card,
  columnId,
  displayPrefs,
  dragInstanceId,
  dragDisabled = false,
  dropDisabled = false,
  isFocused,
  isActiveInPanel,
  isSelected = false,
  onClick,
  onDoubleClick,
  buildDragData,
  onUpdateProperty,
  contextMenu,
}: CardProps) {
  const { position } = useCardPropertyPosition();
  const cardSurfaceRef = useRef<HTMLDivElement | null>(null);
  const activeDragDataRef = useRef<KanbanCardDragData | null>(null);
  const [activeChipEdit, setActiveChipEdit] = useState<{
    property: CardEditableProperty;
    currentToken: string;
    anchorRect: DOMRect;
  } | null>(null);
  const [dragState, setDragState] = useState<
    | { type: "idle" }
    | { type: "dragging" }
    | { type: "preview"; container: HTMLElement; rect: DOMRect; itemCount: number }
  >({ type: "idle" });
  const isDragging = dragState.type === "dragging";
  const showStaticDragGhost = isDragging;
  const handleChipPointerDown = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      event.stopPropagation();
    },
    [],
  );

  const handleOpenPropertyEditor = useCallback(
    (
      property: CardEditableProperty,
      currentToken: string,
      event: React.MouseEvent<HTMLButtonElement>,
    ) => {
      event.preventDefault();
      event.stopPropagation();
      setActiveChipEdit({
        property,
        currentToken,
        anchorRect: event.currentTarget.getBoundingClientRect(),
      });
    },
    [],
  );

  const handleChipEditorClose = useCallback(() => {
    setActiveChipEdit(null);
  }, []);

  const handleChipSelect = useCallback(
    (propertyType: string, _pageId: string, value: string) => {
      if (!onUpdateProperty) {
        return;
      }

      if (propertyType !== "priority" && propertyType !== "estimate") {
        return;
      }

      void onUpdateProperty({
        pageId: card.id,
        columnId,
        property: propertyType,
        value,
      });
    },
    [card.id, columnId, onUpdateProperty],
  );

  useEffect(() => {
    if (dragDisabled) {
      setDragState({ type: "idle" });
      return;
    }

    if (!dragInstanceId || !buildDragData) {
      return;
    }

    const element = cardSurfaceRef.current;
    if (!element) {
      return;
    }

    const onNativeDragStart = (event: DragEvent) => {
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "copyMove";
    };
    element.addEventListener("dragstart", onNativeDragStart);
    const nativeDragCleanup = () => {
      element.removeEventListener("dragstart", onNativeDragStart);
    };

    const draggableCleanup = draggable({
      element,
      getInitialData: () => {
        const dragData = activeDragDataRef.current ?? buildDragData(card, columnId);
        activeDragDataRef.current = dragData;
        return dragData;
      },
      onGenerateDragPreview: ({ location, nativeSetDragImage, source }) => {
        const dragData = isKanbanCardDragData(source.data)
          ? source.data
          : buildDragData(card, columnId);
        const rect = source.element.getBoundingClientRect();

        setCustomNativeDragPreview({
          nativeSetDragImage,
          getOffset: preserveOffsetOnSource({
            element,
            input: location.current.input,
          }),
          render({ container }) {
            setDragState({
              type: "preview",
              container,
              rect,
              itemCount: dragData.dragItems.length,
            });
            return () => {
              setDragState({ type: "dragging" });
            };
          },
        });
      },
      onDragStart: () => {
        setDragState({ type: "dragging" });
      },
      onDrop: () => {
        setDragState({ type: "idle" });
        activeDragDataRef.current = null;
      },
    });

    if (dropDisabled) {
      return combine(nativeDragCleanup, draggableCleanup);
    }

    return combine(
      nativeDragCleanup,
      draggableCleanup,
      dropTargetForElements({
        element,
        canDrop: ({ source }) => canDropOnKanbanCard({
          targetPageId: card.id,
          source: source.data,
          instanceId: dragInstanceId,
        }),
        getIsSticky: () => true,
        getData: () => buildKanbanCardDropTargetData({
          instanceId: dragInstanceId,
          pageId: card.id,
          columnId: columnId as CardType["status"],
        }),
      }),
    );
  }, [buildDragData, card, columnId, dragDisabled, dragInstanceId, dropDisabled]);

  const setCardSurfaceRef = useCallback((element: HTMLDivElement | null) => {
    cardSurfaceRef.current = element;
  }, []);

  const surface = (
    <CardSurface
      projectId={projectId}
      card={card}
      columnId={columnId}
      displayPrefs={displayPrefs}
      className="bn-drag-exclude"
      dragDisabled={dragDisabled}
      showStaticDragGhost={showStaticDragGhost}
      isDragging={isDragging}
      isFocused={isFocused}
      isActiveInPanel={isActiveInPanel}
      isSelected={isSelected}
      position={position}
      activeProperty={activeChipEdit?.property ?? null}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onOpenPropertyEditor={onUpdateProperty ? handleOpenPropertyEditor : undefined}
      onChipPointerDown={onUpdateProperty ? handleChipPointerDown : undefined}
      ref={setCardSurfaceRef}
      {...(contextMenu ? { "data-card-context-menu-trigger": "true" } : {})}
    />
  );

  return (
    <>
      {contextMenu ? (
        <CardContextMenu
          card={card}
          currentColumnId={contextMenu.currentColumnId}
          currentProjectId={contextMenu.currentProjectId}
          currentProjectName={contextMenu.currentProjectName}
          onDelete={contextMenu.onDelete}
          onCopyLink={contextMenu.onCopyLink}
          onMenuOpen={contextMenu.onMenuOpen}
        >
          {surface}
        </CardContextMenu>
      ) : surface}
      {dragState.type === "preview"
        ? createPortal(
          <div
            style={{
              boxSizing: "border-box",
              width: dragState.rect.width,
              height: dragState.rect.height,
            }}
          >
            <div className="relative opacity-90">
              <CardPreview
                projectId={projectId}
                card={card}
                columnId={columnId}
                displayPrefs={displayPrefs}
                isSelected={dragState.itemCount > 1}
                fixedWidth={dragState.rect.width}
                fixedHeight={dragState.rect.height}
              />
              {dragState.itemCount > 1 ? (
                <div className="absolute -top-1.5 -right-1.5 rounded-full bg-(--foreground) px-1.75 py-0.75 text-sm font-medium text-(--background) shadow-lg">
                  {dragState.itemCount}
                </div>
              ) : null}
            </div>
          </div>,
          dragState.container,
        )
        : null}
      {activeChipEdit && onUpdateProperty && (
        <ChipPropertyEditor
          propertyType={activeChipEdit.property}
          currentToken={activeChipEdit.currentToken}
          pageId={card.id}
          anchorRect={activeChipEdit.anchorRect}
          onSelect={handleChipSelect}
          onClose={handleChipEditorClose}
        />
      )}
    </>
  );
}
