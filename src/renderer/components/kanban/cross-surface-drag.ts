import type { CardCreateInput } from "@/lib/types";

export const NODEX_CARD_REFERENCES_DRAG_MIME =
  "application/vnd.nodex.card-references.v1+json";
export const NODEX_BLOCK_CARD_COPIES_DRAG_MIME =
  "application/vnd.nodex.block-card-copies.v1+json";

const VERSION = 1 as const;
const MAX_ITEMS = 128;
const MAX_PAYLOAD_LENGTH = 1_900_000;
const MAX_ID_LENGTH = 512;

export interface CrossSurfaceCardReference {
  readonly projectId: string;
  readonly cardId: string;
  readonly title: string;
}

export interface CrossSurfaceCardReferencePayload {
  readonly version: typeof VERSION;
  readonly kind: "card_references";
  readonly cards: readonly CrossSurfaceCardReference[];
}

export interface CrossSurfaceBlockCardCopyPayload {
  readonly version: typeof VERSION;
  readonly kind: "block_card_copies";
  readonly sourceProjectId: string;
  readonly cards: readonly CardCreateInput[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isBoundedIdentity = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= MAX_ID_LENGTH &&
  value === value.trim();

const parseJson = (serialized: string): unknown => {
  if (!serialized || serialized.length > MAX_PAYLOAD_LENGTH) return null;
  try {
    return JSON.parse(serialized) as unknown;
  } catch {
    return null;
  }
};

export const encodeCardReferenceDragPayload = (
  cards: readonly CrossSurfaceCardReference[],
): string =>
  JSON.stringify({ version: VERSION, kind: "card_references", cards });

export const parseCardReferenceDragPayload = (
  serialized: string,
): CrossSurfaceCardReferencePayload | null => {
  const value = parseJson(serialized);
  if (!isRecord(value)) return null;
  if (value.version !== VERSION || value.kind !== "card_references")
    return null;
  if (
    !Array.isArray(value.cards) ||
    value.cards.length < 1 ||
    value.cards.length > MAX_ITEMS
  ) {
    return null;
  }
  const cards: CrossSurfaceCardReference[] = [];
  for (const candidate of value.cards) {
    if (!isRecord(candidate)) return null;
    if (
      !isBoundedIdentity(candidate.projectId) ||
      !isBoundedIdentity(candidate.cardId)
    ) {
      return null;
    }
    if (typeof candidate.title !== "string" || candidate.title.length > 512)
      return null;
    cards.push({
      projectId: candidate.projectId,
      cardId: candidate.cardId,
      title: candidate.title,
    });
  }
  if (new Set(cards.map((card) => card.cardId)).size !== cards.length)
    return null;
  return { version: VERSION, kind: "card_references", cards };
};

export const encodeBlockCardCopyDragPayload = (
  payload: Omit<CrossSurfaceBlockCardCopyPayload, "version" | "kind">,
): string =>
  JSON.stringify({
    version: VERSION,
    kind: "block_card_copies",
    ...payload,
  });

export const parseBlockCardCopyDragPayload = (
  serialized: string,
): CrossSurfaceBlockCardCopyPayload | null => {
  const value = parseJson(serialized);
  if (!isRecord(value)) return null;
  if (value.version !== VERSION || value.kind !== "block_card_copies")
    return null;
  if (!isBoundedIdentity(value.sourceProjectId)) return null;
  if (
    !Array.isArray(value.cards) ||
    value.cards.length < 1 ||
    value.cards.length > MAX_ITEMS
  ) {
    return null;
  }
  const cards: CardCreateInput[] = [];
  for (const candidate of value.cards) {
    if (!isRecord(candidate)) return null;
    if (
      typeof candidate.title !== "string" ||
      candidate.title.trim().length === 0
    )
      return null;
    if (typeof candidate.description !== "string") return null;
    cards.push({
      title: candidate.title,
      description: candidate.description,
      ...(typeof candidate.priority === "string"
        ? { priority: candidate.priority as CardCreateInput["priority"] }
        : {}),
      ...(typeof candidate.estimate === "string"
        ? { estimate: candidate.estimate as CardCreateInput["estimate"] }
        : {}),
      ...(Array.isArray(candidate.tags) &&
      candidate.tags.every((tag) => typeof tag === "string")
        ? { tags: candidate.tags }
        : {}),
    });
  }
  return {
    version: VERSION,
    kind: "block_card_copies",
    sourceProjectId: value.sourceProjectId,
    cards,
  };
};

export const hasDragType = (
  dataTransfer: Pick<DataTransfer, "types">,
  mime: string,
): boolean => Array.from(dataTransfer.types).includes(mime);
