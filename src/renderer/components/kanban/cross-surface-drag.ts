import type {
  BlockTransferIntentSource,
  BlockTransferMode,
} from "../../../shared/block-transfer";

export const NODEX_BLOCK_TRANSFER_DRAG_MIME =
  "application/vnd.nodex.block-transfer.v1+json";

const VERSION = 1 as const;
const MAX_ITEMS = 128;
const MAX_PAYLOAD_LENGTH = 256 * 1024;
const MAX_ID_LENGTH = 512;

export interface CrossSurfaceBlockTransferPayload {
  readonly version: typeof VERSION;
  readonly kind: "block_transfer";
  readonly projectId: string;
  readonly storeEpoch: string;
  readonly source: BlockTransferIntentSource;
  readonly rootBlockIds: readonly string[];
  readonly displayHints: readonly string[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isBoundedIdentity = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= MAX_ID_LENGTH &&
  value === value.trim();

const parseSource = (value: unknown): BlockTransferIntentSource | null => {
  if (!isRecord(value)) return null;
  if (value.kind === "space" && Object.keys(value).length === 1) {
    return { kind: "space" };
  }
  if (
    value.kind === "document" &&
    Object.keys(value).length === 2 &&
    isBoundedIdentity(value.documentId)
  ) {
    return { kind: "document", documentId: value.documentId };
  }
  if (
    value.kind === "database" &&
    Object.keys(value).length === 2 &&
    isBoundedIdentity(value.databaseBlockId)
  ) {
    return { kind: "database", databaseBlockId: value.databaseBlockId };
  }
  return null;
};

export const encodeBlockTransferDragPayload = (
  payload: Omit<CrossSurfaceBlockTransferPayload, "version" | "kind">,
): string =>
  JSON.stringify({ version: VERSION, kind: "block_transfer", ...payload });

export const parseBlockTransferDragPayload = (
  serialized: string,
): CrossSurfaceBlockTransferPayload | null => {
  if (!serialized || serialized.length > MAX_PAYLOAD_LENGTH) return null;
  let value: unknown;
  try {
    value = JSON.parse(serialized) as unknown;
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;
  if (value.version !== VERSION || value.kind !== "block_transfer") return null;
  if (!isBoundedIdentity(value.projectId) || !isBoundedIdentity(value.storeEpoch)) {
    return null;
  }
  const source = parseSource(value.source);
  if (!source) return null;
  if (
    !Array.isArray(value.rootBlockIds) ||
    value.rootBlockIds.length < 1 ||
    value.rootBlockIds.length > MAX_ITEMS ||
    !value.rootBlockIds.every(isBoundedIdentity) ||
    new Set(value.rootBlockIds).size !== value.rootBlockIds.length
  ) {
    return null;
  }
  if (
    !Array.isArray(value.displayHints) ||
    value.displayHints.length !== value.rootBlockIds.length ||
    !value.displayHints.every(
      (hint) => typeof hint === "string" && hint.length <= MAX_ID_LENGTH,
    )
  ) {
    return null;
  }
  return {
    version: VERSION,
    kind: "block_transfer",
    projectId: value.projectId,
    storeEpoch: value.storeEpoch,
    source,
    rootBlockIds: value.rootBlockIds,
    displayHints: value.displayHints,
  };
};

export const resolveCrossSurfaceTransferMode = (
  event: { readonly altKey: boolean },
): BlockTransferMode => (event.altKey ? "copy" : "move");

export const blockTransferDropLabel = (
  mode: BlockTransferMode,
  target: "document" | "database",
): string =>
  mode === "copy"
    ? target === "database"
      ? "Copy as Card"
      : "Copy into page"
    : target === "database"
      ? "Move to Database"
      : "Move into page";

export const hasDragType = (
  dataTransfer: Pick<DataTransfer, "types">,
  mime: string,
): boolean => Array.from(dataTransfer.types).includes(mime);

let localNativeEditorDragSource: HTMLElement | null = null;

export const beginLocalNativeEditorDrag = (source: HTMLElement): void => {
  localNativeEditorDragSource = source;
};

export const endLocalNativeEditorDrag = (source: HTMLElement): void => {
  if (localNativeEditorDragSource !== source) return;
  localNativeEditorDragSource = null;
};

export const isLocalNativeEditorDragFromAnotherSurface = (
  target: HTMLElement,
): boolean =>
  localNativeEditorDragSource !== null && localNativeEditorDragSource !== target;

/** Native cross-surface DnD is intentionally renderer-window local. */
export const shouldHandleNativeCrossSurfaceDrag = (
  dataTransfer: Pick<DataTransfer, "types">,
): boolean =>
  localNativeEditorDragSource !== null &&
  hasDragType(dataTransfer, NODEX_BLOCK_TRANSFER_DRAG_MIME);
