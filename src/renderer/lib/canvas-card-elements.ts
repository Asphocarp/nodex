import type { BoardSummary, CardSummary } from "./types";
import { buildCardDeepLink } from "./card-deeplink";

/** Marker stored in Excalidraw element customData to identify Nodex cards. */
const CARD_ELEMENT_TYPE = "nodex-card-reference";
const LEGACY_CARD_ELEMENT_TYPE = "nodex-card";

interface CardCustomData {
  type: typeof CARD_ELEMENT_TYPE;
  targetBlockId: string;
  titleHint?: string;
}

interface ExcalidrawElementLike {
  id?: string;
  customData?: Record<string, unknown>;
  label?: { text: string };
  [key: string]: unknown;
}

const PRIORITY_COLORS: Record<string, string> = {
  "p0-critical": "#ffc9c9",
  "p1-high": "#ffd8a8",
  "p2-medium": "#d0ebff",
  "p3-low": "#e9ecef",
  "p4-later": "#f1f3f5",
};
const DEFAULT_CARD_COLOR = "#f8f9fa";

/** Build an ExcalidrawElementSkeleton representing a card on the canvas. */
export function createCardElement(
  card: CardSummary,
  position: { x: number; y: number },
) {
  const label = card.title.length > 60 ? `${card.title.slice(0, 57)}...` : card.title;
  const bg = card.priority ? (PRIORITY_COLORS[card.priority] ?? DEFAULT_CARD_COLOR) : DEFAULT_CARD_COLOR;

  return {
    type: "rectangle" as const,
    x: position.x,
    y: position.y,
    width: 220,
    height: 80,
    backgroundColor: bg,
    fillStyle: "solid" as const,
    strokeColor: "#868e96",
    strokeWidth: 1,
    roundness: { type: 3 },
    link: buildCardDeepLink({ cardId: card.id }),
    label: {
      text: label,
      fontSize: 14,
      fontFamily: 1,
      textAlign: "center" as const,
    },
    customData: {
      type: CARD_ELEMENT_TYPE,
      targetBlockId: card.id,
      titleHint: card.title,
    } satisfies CardCustomData,
  };
}

function asElementRecord(element: unknown): ExcalidrawElementLike | null {
  if (!element || typeof element !== "object") return null;
  return element as ExcalidrawElementLike;
}

/** Type guard: does this Excalidraw element represent an Nodex card? */
export function isCardElement(element: unknown): boolean {
  const type = asElementRecord(element)?.customData?.type;
  return type === CARD_ELEMENT_TYPE || type === LEGACY_CARD_ELEMENT_TYPE;
}

/** Extract cardId from an Nodex card element. Returns null for non-card elements. */
export function getCardIdFromElement(element: unknown): string | null {
  if (!isCardElement(element)) return null;
  const customData = asElementRecord(element)?.customData;
  const cardId = customData?.targetBlockId ?? customData?.cardId;
  return typeof cardId === "string" ? cardId : null;
}

/** Disposable display hint; opening a reference never depends on Database membership. */
export function getCardTitleHintFromElement(element: unknown): string | undefined {
  if (!isCardElement(element)) return undefined;
  const record = asElementRecord(element);
  const titleHint = record?.customData?.titleHint;
  if (typeof titleHint === "string" && titleHint.length > 0) return titleHint;
  const label = record?.label?.text;
  return typeof label === "string" && label.length > 0 ? label : undefined;
}

export function collectPlacedCardIds(elements: readonly unknown[]): Set<string> {
  const ids = new Set<string>();
  for (const element of elements) {
    const cardId = getCardIdFromElement(element);
    if (cardId) ids.add(cardId);
  }
  return ids;
}

export function haveSameCardIds(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  if (left.size !== right.size) return false;
  for (const id of left) {
    if (!right.has(id)) return false;
  }
  return true;
}

export function syncPlacedCardIds(previous: Set<string>, elements: readonly unknown[]): Set<string> {
  const next = collectPlacedCardIds(elements);
  return haveSameCardIds(previous, next) ? previous : next;
}

/** Build a card lookup map from a board summary. Database placement is not Canvas content. */
function buildCardMap(board: BoardSummary): Map<string, CardSummary> {
  const map = new Map<string, CardSummary>();
  for (const col of board.columns) {
    for (const card of col.cards) {
      map.set(card.id, card);
    }
  }
  return map;
}

export type UpdateCanvasElement = (
  element: ExcalidrawElementLike,
  updates: Readonly<Record<string, unknown>>,
) => ExcalidrawElementLike;

/**
 * Given the current Excalidraw elements array and fresh board data,
 * return a new elements array with card labels updated to match current titles.
 * Returns null if no changes were needed (avoids unnecessary updateScene calls).
 */
export function updateCardElements(
  elements: readonly ExcalidrawElementLike[],
  board: BoardSummary,
  updateElement: UpdateCanvasElement,
): ExcalidrawElementLike[] | null {
  const cardMap = buildCardMap(board);
  let changed = false;

  const updated = elements.map((el) => {
    if (!isCardElement(el)) return el;

    const cardId = getCardIdFromElement(el);
    if (!cardId) return el;
    const card = cardMap.get(cardId);
    if (!card) return el; // card was deleted, leave element as-is

    const expectedLabel =
      card.title.length > 60
        ? `${card.title.slice(0, 57)}...`
        : card.title;
    const expectedBg = card.priority
      ? (PRIORITY_COLORS[card.priority] ?? DEFAULT_CARD_COLOR)
      : DEFAULT_CARD_COLOR;

    const currentLabel = (el.label as { text?: string } | undefined)?.text;
    const currentBg = el.backgroundColor as string | undefined;
    const customData = el.customData as unknown as CardCustomData;

    if (
      currentLabel === expectedLabel &&
      currentBg === expectedBg &&
      customData.type === CARD_ELEMENT_TYPE &&
      customData.targetBlockId === cardId &&
      customData.titleHint === card.title
    ) {
      return el;
    }

    changed = true;
    return updateElement(el, {
      backgroundColor: expectedBg,
      label: { ...el.label, text: expectedLabel },
      customData: {
        type: CARD_ELEMENT_TYPE,
        targetBlockId: cardId,
        titleHint: card.title,
      },
    });
  });

  return changed ? updated : null;
}
