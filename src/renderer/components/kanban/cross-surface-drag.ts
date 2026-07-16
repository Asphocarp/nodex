import type {
  BlockTransferIntentSource,
  BlockTransferMode,
} from "../../../shared/block-transfer";
import type { PublicBlockTransferIntent } from "../../../shared/block-transfer-transport";

export const NODEX_BLOCK_TRANSFER_DRAG_MIME =
  "application/vnd.nodex.block-transfer.v2+json";

const VERSION = 2 as const;
const MAX_ITEMS = 128;
const MAX_PAYLOAD_LENGTH = 256 * 1024;
const MAX_ID_LENGTH = 512;

export interface CrossSurfaceBlockTransferPayload {
  readonly version: typeof VERSION;
  readonly kind: "block_transfer";
  readonly sessionId: string;
  readonly sourceSurfaceId: string;
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
  if (
    value.kind === "library" &&
    Object.keys(value).length === 2 &&
    isBoundedIdentity(value.libraryId)
  ) {
    return { kind: "library", libraryId: value.libraryId };
  }
  if (
    value.kind === "page" &&
    Object.keys(value).length === 2 &&
    isBoundedIdentity(value.pageId)
  ) {
    return { kind: "page", pageId: value.pageId };
  }
  if (
    value.kind === "document" &&
    Object.keys(value).length === 2 &&
    isBoundedIdentity(value.documentId)
  ) {
    return { kind: "document", documentId: value.documentId };
  }
  if (
    value.kind === "data_source" &&
    Object.keys(value).length === 2 &&
    isBoundedIdentity(value.dataSourceId)
  ) {
    return { kind: "data_source", dataSourceId: value.dataSourceId };
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
  if (
    !isBoundedIdentity(value.sessionId) ||
    !isBoundedIdentity(value.sourceSurfaceId) ||
    !isBoundedIdentity(value.projectId) ||
    !isBoundedIdentity(value.storeEpoch)
  ) {
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
    sessionId: value.sessionId,
    sourceSurfaceId: value.sourceSurfaceId,
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
  target: "page" | "data_source",
): string =>
  mode === "copy"
    ? target === "data_source"
      ? "Copy as Page"
      : "Copy into page"
    : target === "data_source"
      ? "Move to Database"
      : "Move into page";

export const buildBlockToDataSourceTransferIntent = (input: {
  readonly operationId: string;
  readonly projectId: string;
  readonly storeEpoch: string;
  readonly payload: CrossSurfaceBlockTransferPayload;
  readonly dataSourceId: string;
  readonly viewId: string;
  readonly groupKey: string;
  readonly beforePageId?: string;
  readonly altKey: boolean;
}): PublicBlockTransferIntent => ({
  version: 2,
  operationId: input.operationId,
  projectId: input.projectId,
  storeEpoch: input.storeEpoch,
  mode: resolveCrossSurfaceTransferMode(input),
  rootBlockIds: input.payload.rootBlockIds,
  source: input.payload.source,
  target: {
    kind: "data_source",
    dataSourceId: input.dataSourceId,
    viewId: input.viewId,
    groupKey: input.groupKey,
    ...(input.beforePageId
      ? { beforePageId: input.beforePageId }
      : {}),
  },
});

export const hasDragType = (
  dataTransfer: Pick<DataTransfer, "types">,
  mime: string,
): boolean => Array.from(dataTransfer.types).includes(mime);

export interface LocalBlockDragSession {
  readonly sessionId: string;
  readonly sourceSurfaceId: string;
  readonly payload: CrossSurfaceBlockTransferPayload;
}

export interface RegisterLocalBlockDragDropTarget {
  readonly surfaceId: string;
  readonly element: HTMLElement;
  readonly deactivate: () => void;
}

type LocalBlockDragDropTarget = RegisterLocalBlockDragDropTarget;

export interface ClaimLocalBlockDragDropTarget {
  readonly surfaceId: string;
  readonly event: Pick<Event, "composedPath">;
}

export class BlockDragSessionCoordinator {
  private active: LocalBlockDragSession | null = null;
  private readonly dropTargetsByElement = new WeakMap<
    HTMLElement,
    LocalBlockDragDropTarget
  >();
  private activeDropTarget: LocalBlockDragDropTarget | null = null;

  constructor(
    private readonly createSessionId: () => string = () =>
      crypto.randomUUID(),
  ) {}

  start(
    input: Omit<
      CrossSurfaceBlockTransferPayload,
      "version" | "kind" | "sessionId" | "sourceSurfaceId"
    > & { readonly sourceSurfaceId: string },
    dataTransfer: DataTransfer,
  ): LocalBlockDragSession {
    this.setActiveDropTarget(null);
    const sessionId = this.createSessionId();
    const payload: CrossSurfaceBlockTransferPayload = {
      version: VERSION,
      kind: "block_transfer",
      sessionId,
      sourceSurfaceId: input.sourceSurfaceId,
      projectId: input.projectId,
      storeEpoch: input.storeEpoch,
      source: input.source,
      rootBlockIds: [...input.rootBlockIds],
      displayHints: [...input.displayHints],
    };
    const session = {
      sessionId,
      sourceSurfaceId: input.sourceSurfaceId,
      payload,
    } satisfies LocalBlockDragSession;

    dataTransfer.setData(
      NODEX_BLOCK_TRANSFER_DRAG_MIME,
      encodeBlockTransferDragPayload(payload),
    );
    dataTransfer.effectAllowed = "copyMove";
    this.active = session;
    return session;
  }

  registerDropTarget(input: RegisterLocalBlockDragDropTarget): () => void {
    const existing = this.dropTargetsByElement.get(input.element);
    if (existing) {
      throw new Error(
        `Block drag drop target ${existing.surfaceId} already owns this element`,
      );
    }
    const target = { ...input } satisfies LocalBlockDragDropTarget;
    this.dropTargetsByElement.set(input.element, target);
    return () => {
      if (this.dropTargetsByElement.get(input.element) !== target) return;
      this.dropTargetsByElement.delete(input.element);
      if (this.activeDropTarget === target) this.setActiveDropTarget(null);
    };
  }

  claimDropTarget(input: ClaimLocalBlockDragDropTarget): boolean {
    if (!this.active) {
      this.setActiveDropTarget(null);
      return false;
    }
    const target = this.resolveDeepestDropTarget(input.event.composedPath());
    this.setActiveDropTarget(target);
    return target?.surfaceId === input.surfaceId;
  }

  releaseDropTarget(surfaceId: string): void {
    if (this.activeDropTarget?.surfaceId !== surfaceId) return;
    this.setActiveDropTarget(null);
  }

  resolve(
    dataTransfer: Pick<DataTransfer, "types"> | null | undefined,
  ): LocalBlockDragSession | null {
    if (!this.active || !dataTransfer) return null;
    if (!hasDragType(dataTransfer, NODEX_BLOCK_TRANSFER_DRAG_MIME)) return null;
    return this.active;
  }

  resolveDrop(
    dataTransfer:
      | Pick<DataTransfer, "types" | "getData">
      | null
      | undefined,
  ): LocalBlockDragSession | null {
    const session = this.resolve(dataTransfer);
    if (!session || !dataTransfer) return null;
    const token = parseBlockTransferDragPayload(
      dataTransfer.getData(NODEX_BLOCK_TRANSFER_DRAG_MIME),
    );
    return token?.sessionId === session.sessionId ? session : null;
  }

  end(input?: {
    readonly sessionId?: string;
    readonly sourceSurfaceId?: string;
  }): void {
    if (!this.active) return;
    if (input?.sessionId && input.sessionId !== this.active.sessionId) return;
    if (
      input?.sourceSurfaceId &&
      input.sourceSurfaceId !== this.active.sourceSurfaceId
    ) {
      return;
    }
    this.setActiveDropTarget(null);
    this.active = null;
  }

  private resolveDeepestDropTarget(
    composedPath: readonly EventTarget[],
  ): LocalBlockDragDropTarget | null {
    for (const entry of composedPath) {
      if (!(entry instanceof HTMLElement)) continue;
      const target = this.dropTargetsByElement.get(entry);
      if (target) return target;
    }
    return null;
  }

  private setActiveDropTarget(target: LocalBlockDragDropTarget | null): void {
    if (this.activeDropTarget === target) return;
    const previous = this.activeDropTarget;
    this.activeDropTarget = target;
    previous?.deactivate();
  }
}

export const blockDragSessionCoordinator = new BlockDragSessionCoordinator();

export const beginLocalBlockDragSession = (
  input: Parameters<BlockDragSessionCoordinator["start"]>[0],
  dataTransfer: DataTransfer,
): LocalBlockDragSession => blockDragSessionCoordinator.start(input, dataTransfer);

export const endLocalBlockDragSession = (
  input?: Parameters<BlockDragSessionCoordinator["end"]>[0],
): void => blockDragSessionCoordinator.end(input);

export const resolveLocalBlockDragSession = (
  dataTransfer: Pick<DataTransfer, "types"> | null | undefined,
): LocalBlockDragSession | null => blockDragSessionCoordinator.resolve(dataTransfer);

export const registerLocalBlockDragDropTarget = (
  input: RegisterLocalBlockDragDropTarget,
): (() => void) => blockDragSessionCoordinator.registerDropTarget(input);

export const claimLocalBlockDragDropTarget = (
  input: ClaimLocalBlockDragDropTarget,
): boolean => blockDragSessionCoordinator.claimDropTarget(input);

export const releaseLocalBlockDragDropTarget = (surfaceId: string): void =>
  blockDragSessionCoordinator.releaseDropTarget(surfaceId);

/** Resolve the authoritative session only after its drop-readable token matches. */
export const resolveLocalBlockDragDropSession = (
  dataTransfer:
    | Pick<DataTransfer, "types" | "getData">
    | null
    | undefined,
): LocalBlockDragSession | null =>
  blockDragSessionCoordinator.resolveDrop(dataTransfer);

export const shouldBlockNoteYieldManagedDrag = (input: {
  readonly session: LocalBlockDragSession | null;
  readonly currentSurfaceId: string;
  readonly currentSurfaceElement: HTMLElement;
  readonly eventTarget: EventTarget | null;
}): boolean => {
  if (!input.session) return false;
  if (input.session.sourceSurfaceId !== input.currentSurfaceId) return true;
  if (!(input.eventTarget instanceof Element)) return true;
  return (
    input.eventTarget.closest(".nfm-editor") !== input.currentSurfaceElement
  );
};

/** Native cross-surface DnD is intentionally renderer-window local. */
export const shouldHandleNativeCrossSurfaceDrag = (
  dataTransfer: Pick<DataTransfer, "types">,
): boolean =>
  resolveLocalBlockDragSession(dataTransfer) !== null;

if (typeof window !== "undefined") {
  window.addEventListener("blur", () => blockDragSessionCoordinator.end());
}
