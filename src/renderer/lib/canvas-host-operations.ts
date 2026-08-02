import type { BlockDocumentSurfaceRuntime } from "./block-document-surface-runtime";
import { canvasDocumentSessionRegistry } from "./canvas-document-session";
import { canvasSceneSurfaceRegistry } from "./canvas-scene-surface-runtime";
import {
  applyLibraryModule,
  readLibraryModule,
} from "./api";
import { createUuidV7 } from "../../shared/uuid-v7";
import type { ContentAccessContext } from "../../shared/content-access-context";
import {
  LIBRARY_MODULE_CONTRACT_VERSION,
  type LibraryModuleApplyReceipt,
  type LibraryModuleApplyRequest,
  type LibraryCanvasDestination,
  type LibraryPageInsertion,
  type LibraryCanvasSummary,
} from "../../shared/library-module";

export type CanvasHostDocumentRuntime = Pick<
  BlockDocumentSurfaceRuntime,
  "getStatus" | "prepareDurableMutation"
>;

const canvasHostRuntimesBySurfaceId = new Map<
  string,
  CanvasHostDocumentRuntime
>();

export function registerCanvasHostDocumentRuntime(
  surfaceId: string,
  runtime: CanvasHostDocumentRuntime,
): () => void {
  canvasHostRuntimesBySurfaceId.set(surfaceId, runtime);
  return () => {
    if (canvasHostRuntimesBySurfaceId.get(surfaceId) !== runtime) return;
    canvasHostRuntimesBySurfaceId.delete(surfaceId);
  };
}

export function resolveCanvasHostDocumentRuntime(
  surfaceId: string,
): CanvasHostDocumentRuntime | null {
  return canvasHostRuntimesBySurfaceId.get(surfaceId) ?? null;
}

type LibraryCanvasPageDestination = Extract<
  LibraryCanvasDestination,
  { readonly kind: "page" }
>;

export type CanvasHostDocumentRevision = Pick<
  LibraryCanvasPageDestination,
  "expectedDocumentGeneration" | "expectedDocumentHeadSeq"
>;

export interface PreparedCanvasHost {
  readonly storeEpoch: string;
  readonly documentRevision: CanvasHostDocumentRevision;
}

export function isCanvasHostDocumentRuntime(
  value: unknown,
): value is CanvasHostDocumentRuntime {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<CanvasHostDocumentRuntime>;
  return typeof candidate.getStatus === "function"
    && typeof candidate.prepareDurableMutation === "function";
}

export async function prepareCanvasHost(
  runtime: CanvasHostDocumentRuntime,
): Promise<PreparedCanvasHost> {
  const before = runtime.getStatus();
  if (before.writeFrozen) {
    throw new Error("This Page is already completing another Block change.");
  }
  if (!before.ready || before.reloadRequired) {
    throw new Error("The Page Document is not ready for a Canvas change.");
  }

  const status = await runtime.prepareDurableMutation();
  if (!status.ready || status.reloadRequired || status.writeFrozen) {
    throw new Error("The Page Document changed while preparing Canvas.");
  }
  const storeEpoch = status.descriptor.storeEpoch;
  const generation = status.provider.generation;
  const headSeq = status.provider.headSeq;
  if (
    !storeEpoch
    || storeEpoch !== storeEpoch.trim()
    || !Number.isSafeInteger(generation)
    || generation === undefined
    || generation < 1
    || !Number.isSafeInteger(headSeq)
    || headSeq < 0
  ) {
    throw new Error("The Page Document revision is unavailable.");
  }
  return {
    storeEpoch,
    documentRevision: {
      expectedDocumentGeneration: generation,
      expectedDocumentHeadSeq: headSeq,
    },
  };
}

export function createCanvasPageDestination(input: {
  readonly pageId: string;
  readonly documentRevision: CanvasHostDocumentRevision;
  readonly insertion: LibraryPageInsertion;
}): LibraryCanvasPageDestination {
  return {
    kind: "page",
    pageId: input.pageId,
    expectedDocumentGeneration:
      input.documentRevision.expectedDocumentGeneration,
    expectedDocumentHeadSeq: input.documentRevision.expectedDocumentHeadSeq,
    insertion: input.insertion,
  };
}

function requireCanvasHostStoreEpoch(
  storeEpoch: string,
  ...hosts: readonly PreparedCanvasHost[]
): void {
  if (hosts.every((host) => host.storeEpoch === storeEpoch)) return;
  throw new Error("The Store changed while preparing Canvas.");
}

export async function applyLibraryRequestWithExactRetry(
  accessContext: ContentAccessContext,
  request: LibraryModuleApplyRequest,
  apply: typeof applyLibraryModule = applyLibraryModule,
): Promise<LibraryModuleApplyReceipt> {
  let thrown: unknown = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let result: Awaited<ReturnType<typeof apply>>;
    try {
      result = await apply(accessContext, request);
    } catch (error) {
      thrown = error;
      if (attempt === 0) continue;
      break;
    }
    if (result.ok) return result.value;
    if (attempt === 0 && result.error.retryable) continue;
    throw new Error(result.error.message);
  }
  throw thrown instanceof Error
    ? thrown
    : new Error("Canvas change failed.");
}

async function readAvailableCanvas(
  accessContext: ContentAccessContext,
  canvasId: string,
): Promise<{
  readonly storeEpoch: string;
  readonly summary: LibraryCanvasSummary;
}> {
  const result = await readLibraryModule(accessContext, {
    version: LIBRARY_MODULE_CONTRACT_VERSION,
    read: { mode: "canvas_target", canvasId },
  });
  if (!result.ok) throw new Error(result.error.message);
  const target = result.value.value;
  if (target.kind !== "canvas_target") {
    throw new Error("Library returned the wrong Canvas target.");
  }
  if (target.value.status !== "available") {
    throw new Error(
      target.value.status === "deleted"
        ? "This Canvas has already been deleted."
        : "Canvas is no longer available.",
    );
  }
  return {
    storeEpoch: result.value.storeEpoch,
    summary: target.value.summary,
  };
}

export async function createCanvasInHostPage(input: {
  readonly accessContext: ContentAccessContext;
  readonly hostPageId: string;
  readonly replacementBlockId: string;
  readonly displayName?: string;
  readonly runtime: CanvasHostDocumentRuntime;
  readonly identities?: {
    readonly operationId: string;
    readonly canvasId: string;
    readonly documentId: string;
  };
}): Promise<{
  readonly canvasBlockId: string;
  readonly receipt: LibraryModuleApplyReceipt;
}> {
  const host = await prepareCanvasHost(input.runtime);
  const identities = input.identities ?? {
    operationId: createUuidV7(),
    canvasId: createUuidV7(),
    documentId: createUuidV7(),
  };
  const request = {
    version: LIBRARY_MODULE_CONTRACT_VERSION,
    operationId: identities.operationId,
    storeEpoch: host.storeEpoch,
    operation: {
      kind: "create_canvas",
      canvasId: identities.canvasId,
      documentId: identities.documentId,
      displayName: input.displayName?.trim() || "Untitled Canvas",
      destination: createCanvasPageDestination({
        pageId: input.hostPageId,
        documentRevision: host.documentRevision,
        insertion: {
          kind: "replace_empty_paragraph",
          blockId: input.replacementBlockId,
        },
      }),
    },
  } as const satisfies LibraryModuleApplyRequest;

  return {
    canvasBlockId: identities.canvasId,
    receipt: await applyLibraryRequestWithExactRetry(
      input.accessContext,
      request,
    ),
  };
}

export async function renameCanvasOwner(input: {
  readonly accessContext: ContentAccessContext;
  readonly canvasBlockId: string;
  readonly displayName: string;
  readonly operationId?: string;
}): Promise<LibraryModuleApplyReceipt> {
  const target = await readAvailableCanvas(
    input.accessContext,
    input.canvasBlockId,
  );
  return applyLibraryRequestWithExactRetry(input.accessContext, {
    version: LIBRARY_MODULE_CONTRACT_VERSION,
    operationId: input.operationId ?? createUuidV7(),
    storeEpoch: target.storeEpoch,
    operation: {
      kind: "rename_canvas",
      canvasId: input.canvasBlockId,
      displayName: input.displayName.trim() || "Untitled Canvas",
      expectedMetadataRevision: target.summary.metadataRevision,
    },
  });
}

export async function deleteCanvasOwner(input: {
  readonly accessContext: ContentAccessContext;
  readonly canvasBlockId: string;
  readonly operationId?: string;
}, dependencies: {
  readonly readTarget?: typeof readAvailableCanvas;
  readonly apply?: typeof applyLibraryModule;
  readonly retireOwner?: (
    projectId: string,
    ownerBlockId: string,
  ) => Promise<void>;
} = {}): Promise<LibraryModuleApplyReceipt> {
  const target = await (
    dependencies.readTarget ?? readAvailableCanvas
  )(input.accessContext, input.canvasBlockId);
  const receipt = await applyLibraryRequestWithExactRetry(input.accessContext, {
    version: LIBRARY_MODULE_CONTRACT_VERSION,
    operationId: input.operationId ?? createUuidV7(),
    storeEpoch: target.storeEpoch,
    operation: {
      kind: "delete_canvas",
      canvasId: input.canvasBlockId,
      expectedLocationRevision: target.summary.locationRevision,
      expectedMetadataRevision: target.summary.metadataRevision,
    },
  }, dependencies.apply);
  await (
    dependencies.retireOwner ?? canvasDocumentSessionRegistry.retireOwner
  )(target.summary.projectId, input.canvasBlockId).catch(() => undefined);
  return receipt;
}

export async function duplicateCanvasInHostPage(input: {
  readonly accessContext: ContentAccessContext;
  readonly sourceCanvasBlockId: string;
  readonly hostPageId: string;
  readonly insertion: LibraryPageInsertion;
  readonly runtime: CanvasHostDocumentRuntime;
  readonly displayName?: string;
  readonly identities?: {
    readonly operationId: string;
    readonly canvasId: string;
    readonly documentId: string;
  };
}): Promise<{
  readonly canvasBlockId: string;
  readonly receipt: LibraryModuleApplyReceipt;
}> {
  const host = await prepareCanvasHost(input.runtime);
  await canvasSceneSurfaceRegistry.flushOwnerCommitted(
    input.sourceCanvasBlockId,
  );
  const target = await readAvailableCanvas(
    input.accessContext,
    input.sourceCanvasBlockId,
  );
  requireCanvasHostStoreEpoch(target.storeEpoch, host);
  const identities = input.identities ?? {
    operationId: createUuidV7(),
    canvasId: createUuidV7(),
    documentId: createUuidV7(),
  };
  const receipt = await applyLibraryRequestWithExactRetry(input.accessContext, {
    version: LIBRARY_MODULE_CONTRACT_VERSION,
    operationId: identities.operationId,
    storeEpoch: target.storeEpoch,
    operation: {
      kind: "duplicate_canvas",
      sourceCanvasId: input.sourceCanvasBlockId,
      canvasId: identities.canvasId,
      documentId: identities.documentId,
      ...(input.displayName?.trim()
        ? { displayName: input.displayName.trim() }
        : {}),
      expectedDocumentGeneration: target.summary.documentGeneration,
      expectedDocumentHeadSeq: target.summary.documentHeadSeq,
      destination: createCanvasPageDestination({
        pageId: input.hostPageId,
        documentRevision: host.documentRevision,
        insertion: input.insertion,
      }),
    },
  });
  return { canvasBlockId: identities.canvasId, receipt };
}

export async function moveCanvasOwnerToPage(input: {
  readonly accessContext: ContentAccessContext;
  readonly canvasBlockId: string;
  readonly targetPageId: string;
  readonly targetDocumentGeneration: number;
  readonly targetDocumentHeadSeq: number;
  readonly insertion: LibraryPageInsertion;
  readonly sourceRuntime: CanvasHostDocumentRuntime;
  readonly operationId?: string;
}): Promise<LibraryModuleApplyReceipt> {
  const sourceHost = await prepareCanvasHost(input.sourceRuntime);
  const target = await readAvailableCanvas(
    input.accessContext,
    input.canvasBlockId,
  );
  requireCanvasHostStoreEpoch(target.storeEpoch, sourceHost);
  return applyLibraryRequestWithExactRetry(input.accessContext, {
    version: LIBRARY_MODULE_CONTRACT_VERSION,
    operationId: input.operationId ?? createUuidV7(),
    storeEpoch: target.storeEpoch,
    operation: {
      kind: "move_canvas",
      canvasId: input.canvasBlockId,
      expectedLocationRevision: target.summary.locationRevision,
      destination: createCanvasPageDestination({
        pageId: input.targetPageId,
        documentRevision: {
          expectedDocumentGeneration: input.targetDocumentGeneration,
          expectedDocumentHeadSeq: input.targetDocumentHeadSeq,
        },
        insertion: input.insertion,
      }),
    },
  });
}

export async function moveCanvasOwnerBetweenHostPages(input: {
  readonly accessContext: ContentAccessContext;
  readonly canvasBlockId: string;
  readonly targetPageId: string;
  readonly insertion: LibraryPageInsertion;
  readonly sourceRuntime: CanvasHostDocumentRuntime;
  readonly targetRuntime: CanvasHostDocumentRuntime;
  readonly operationId?: string;
}): Promise<LibraryModuleApplyReceipt> {
  const sourceHost = await prepareCanvasHost(
    input.sourceRuntime,
  );
  const targetHost = input.sourceRuntime === input.targetRuntime
    ? sourceHost
    : await prepareCanvasHost(input.targetRuntime);
  const target = await readAvailableCanvas(
    input.accessContext,
    input.canvasBlockId,
  );
  requireCanvasHostStoreEpoch(target.storeEpoch, sourceHost, targetHost);
  return applyLibraryRequestWithExactRetry(input.accessContext, {
    version: LIBRARY_MODULE_CONTRACT_VERSION,
    operationId: input.operationId ?? createUuidV7(),
    storeEpoch: target.storeEpoch,
    operation: {
      kind: "move_canvas",
      canvasId: input.canvasBlockId,
      expectedLocationRevision: target.summary.locationRevision,
      destination: createCanvasPageDestination({
        pageId: input.targetPageId,
        documentRevision: targetHost.documentRevision,
        insertion: input.insertion,
      }),
    },
  });
}

export function resolveCanvasDropInsertion(input: {
  readonly parentBlockId?: string;
  readonly beforeBlockId?: string;
}): LibraryPageInsertion {
  if (input.beforeBlockId) {
    return {
      kind: "before",
      ...(input.parentBlockId
        ? { parentBlockId: input.parentBlockId }
        : {}),
      anchorBlockId: input.beforeBlockId,
    };
  }
  return {
    kind: "append",
    ...(input.parentBlockId
      ? { parentBlockId: input.parentBlockId }
      : {}),
  };
}

export function resolveCanvasInsertionAfterBlock(input: {
  readonly blockId: string;
  readonly parentBlockId?: string;
  readonly siblingBlockIds: readonly string[];
}): LibraryPageInsertion {
  const index = input.siblingBlockIds.indexOf(input.blockId);
  if (index < 0) {
    throw new Error("Canvas Block is no longer in the host Page.");
  }
  const nextBlockId = input.siblingBlockIds[index + 1];
  if (nextBlockId) {
    return {
      kind: "before",
      ...(input.parentBlockId
        ? { parentBlockId: input.parentBlockId }
        : {}),
      anchorBlockId: nextBlockId,
    };
  }
  return {
    kind: "append",
    ...(input.parentBlockId
      ? { parentBlockId: input.parentBlockId }
      : {}),
  };
}
