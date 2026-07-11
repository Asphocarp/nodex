import {
  resolveInvokeTransport,
  resolveRendererTransport,
} from "./renderer-transport";
import type { IpcApi } from "../../shared/ipc-api";
import type { DocumentSyncAdapter } from "./nodex-y-provider";
import type {
  OwnedBlockDocumentDescriptor,
  RelocationCommandResult,
} from "../../shared/block-documents/contracts";
import type { DocumentSyncCommandResult } from "../../shared/block-documents/document-sync";
import type { DocumentRelocationRequest } from "../../shared/block-documents/relocation-transport";
import type {
  CardReferenceReadModel,
  ResolveCardReferenceInput,
} from "../../shared/block-references";
import type {
  DatabaseViewReadModel,
  ReadDatabaseViewReferenceInput,
} from "../../shared/database-views";
import type {
  BlockPropertyMutationCommandResult,
  BlockPropertyMutationRequest,
} from "../../shared/block-property-mutations";
import {
  parseCardMetadataPropertySnapshotCommandResult,
  type CardMetadataPropertySnapshotCommandResult,
} from "../../shared/card-metadata-property-snapshot-transport";
import type {
  DatabaseMutationCommandResult,
  DatabaseMutationRequest,
} from "../../shared/database-kernel";
import type {
  DatabaseCatalogSnapshotCommandResult,
  DatabaseReadCommandResult,
  DatabaseViewSnapshotCommandResult,
  GeneralDatabaseDescriptor,
  GeneralDatabaseViewQuery,
  PrimaryDatabaseViewSnapshotCommandResult,
} from "../../shared/database-query";
import type {
  DocumentMutationRequest,
  DocumentOperationCommandResult,
} from "../../shared/block-documents/document-operations";
import type {
  CreateDocumentVersionCheckpoint,
  CreatedDocumentVersionSummary,
  DocumentVersionDetail,
  DocumentVersionSummary,
  GetDocumentVersion,
  ListDocumentVersions,
  PrepareDocumentVersionRestore,
} from "../../shared/block-documents/document-history";
import type { DocumentHistoryCommandResult } from "../../shared/block-documents/document-history-transport";
import type {
  CardLifecycleMutationCommandResult,
  CardLifecycleMutationRequest,
} from "../../shared/card-lifecycle";
import type { CardLifecyclePreflightResult } from "../../shared/card-lifecycle-runtime";
import type { ListCardHistoryRequest } from "../../shared/card-history";
import type { CardHistoryCommandResult } from "../../shared/card-history-transport";
import type { AdditionalDocumentCommandResult } from "../../shared/additional-document-commands";
import type { PublicAdditionalDocumentCommandRequest } from "../../shared/additional-document-command-transport";

const BROWSER_CODEX_INVOKE_CHANNELS = new Set<string>([
  "codex:thread:archive",
  "codex:thread:unarchive",
]);

export async function invoke<Channel extends keyof IpcApi>(
  channel: Channel,
  ...args: IpcApi[Channel]["args"]
): Promise<IpcApi[Channel]["result"]>;
export async function invoke(
  channel: string,
  ...args: unknown[]
): Promise<unknown>;
export async function invoke(
  channel: string,
  ...args: unknown[]
): Promise<unknown> {
  const transport = resolveInvokeTransport(channel);

  if (
    channel.startsWith("codex:") &&
    transport.kind !== "electron" &&
    !BROWSER_CODEX_INVOKE_CHANNELS.has(channel)
  ) {
    throw new Error("Codex threads require Electron in this release");
  }

  return transport.invoke(channel, ...args);
}

export function createDocumentSyncAdapter(
  projectId: string,
): DocumentSyncAdapter {
  const transport = resolveRendererTransport();
  const createAdapter = transport.createDocumentSyncAdapter;
  if (createAdapter) {
    return createAdapter(projectId);
  }
  throw new Error("Document sync is unavailable for this renderer transport");
}

export function getOwnedBlockDocumentDescriptor(
  projectId: string,
  ownerBlockId: string,
): Promise<OwnedBlockDocumentDescriptor> {
  return resolveRendererTransport().getOwnedBlockDocumentDescriptor(
    projectId,
    ownerBlockId,
  );
}

export function prepareOwnedBlockDocument(
  projectId: string,
  ownerBlockId: string,
): Promise<DocumentSyncCommandResult<OwnedBlockDocumentDescriptor>> {
  return resolveRendererTransport().prepareOwnedBlockDocument(
    projectId,
    ownerBlockId,
  );
}

export function relocateBlocks(
  request: DocumentRelocationRequest,
): Promise<RelocationCommandResult> {
  return resolveRendererTransport().relocateBlocks(request);
}

export function mutateDocument(
  projectId: string,
  documentId: string,
  request: DocumentMutationRequest,
): Promise<DocumentOperationCommandResult> {
  return resolveRendererTransport().mutateDocument(
    projectId,
    documentId,
    request,
  );
}

export function applyAdditionalDocumentCommand(
  projectId: string,
  request: PublicAdditionalDocumentCommandRequest,
): Promise<AdditionalDocumentCommandResult> {
  return resolveRendererTransport().applyAdditionalDocumentCommand(
    projectId,
    request,
  );
}

export function createDocumentVersionCheckpoint(
  projectId: string,
  documentId: string,
  request: CreateDocumentVersionCheckpoint,
): Promise<DocumentHistoryCommandResult<CreatedDocumentVersionSummary>> {
  return resolveRendererTransport().createDocumentVersionCheckpoint(
    projectId,
    documentId,
    request,
  );
}

export function listDocumentVersions(
  request: ListDocumentVersions,
): Promise<DocumentHistoryCommandResult<readonly DocumentVersionSummary[]>> {
  return resolveRendererTransport().listDocumentVersions(request);
}

export function getDocumentVersion(
  request: GetDocumentVersion,
): Promise<DocumentHistoryCommandResult<DocumentVersionDetail>> {
  return resolveRendererTransport().getDocumentVersion(request);
}

export function restoreDocumentVersion(
  projectId: string,
  documentId: string,
  request: PrepareDocumentVersionRestore,
): Promise<DocumentOperationCommandResult> {
  return resolveRendererTransport().restoreDocumentVersion(
    projectId,
    documentId,
    request,
  );
}

export function resolveCardReference(
  input: ResolveCardReferenceInput,
): Promise<CardReferenceReadModel | null> {
  return invoke("block-reference:card:resolve", input);
}

export function readDatabaseViewReference(
  input: ReadDatabaseViewReferenceInput,
): Promise<DatabaseViewReadModel | null> {
  return invoke("database-view:reference:get", input);
}

export function mutateBlockProperties(
  projectId: string,
  request: BlockPropertyMutationRequest,
): Promise<BlockPropertyMutationCommandResult> {
  return invoke("block-properties:mutate", projectId, request);
}

export async function readCardMetadataPropertySnapshot(
  projectId: string,
  cardBlockId: string,
): Promise<CardMetadataPropertySnapshotCommandResult> {
  return parseCardMetadataPropertySnapshotCommandResult(
    await invoke(
      "cards:metadata-properties:snapshot",
      projectId,
      cardBlockId,
    ),
  );
}

export function readCardLifecyclePreflight(
  projectId: string,
  cardId: string,
): Promise<CardLifecyclePreflightResult> {
  return resolveRendererTransport().readCardLifecyclePreflight(
    projectId,
    cardId,
  );
}

export function mutateCardLifecycle(
  projectId: string,
  request: CardLifecycleMutationRequest,
): Promise<CardLifecycleMutationCommandResult> {
  return resolveRendererTransport().mutateCardLifecycle(projectId, request);
}

export function listCardHistory(
  request: ListCardHistoryRequest,
): Promise<CardHistoryCommandResult> {
  return resolveRendererTransport().listCardHistory(request);
}

export function mutateDatabase(
  projectId: string,
  request: DatabaseMutationRequest,
): Promise<DatabaseMutationCommandResult> {
  return invoke("databases:mutate", projectId, request);
}

export function readDatabaseCatalog(
  projectId: string,
): Promise<DatabaseCatalogSnapshotCommandResult> {
  return invoke("databases:catalog:get", projectId);
}

export function readDatabaseDescriptor(
  projectId: string,
  databaseBlockId: string,
): Promise<DatabaseReadCommandResult<GeneralDatabaseDescriptor>> {
  return invoke("databases:descriptor:get", projectId, databaseBlockId);
}

export function readPrimaryDatabaseDescriptor(
  projectId: string,
): Promise<DatabaseReadCommandResult<GeneralDatabaseDescriptor>> {
  return invoke("databases:primary:get", projectId);
}

export function readPrimaryDatabaseViewSnapshot(
  projectId: string,
): Promise<PrimaryDatabaseViewSnapshotCommandResult> {
  return invoke("database-views:primary:snapshot", projectId);
}

export function readDatabaseViewSnapshot(
  projectId: string,
  viewId: string,
): Promise<DatabaseViewSnapshotCommandResult> {
  return invoke("database-views:snapshot", projectId, viewId);
}

export function queryDatabaseView(
  projectId: string,
  viewId: string,
): Promise<DatabaseReadCommandResult<GeneralDatabaseViewQuery>> {
  return invoke("database-views:query", projectId, viewId);
}

export function subscribeBoardChanges(
  projectId: string,
  callback: (event: import("../../shared/ipc-api").BoardChangeEvent) => void,
): () => void {
  return resolveRendererTransport().subscribeBoardChanges(projectId, callback);
}

export function subscribeDatabaseChanges(
  projectId: string,
  callback: (event: import("../../shared/database-events").DatabaseChangeEvent) => void,
): () => void {
  return resolveRendererTransport().subscribeDatabaseChanges(
    projectId,
    callback,
  );
}

export function subscribeProjectSessionChanges(
  projectId: string | null,
  callback: (
    event: import("../../shared/ipc-api").ProjectSessionsChangeEvent,
  ) => void,
): () => void {
  return resolveRendererTransport().subscribeProjectSessionChanges(
    projectId,
    callback,
  );
}

export function subscribeProjectChanges(
  callback: (event: import("../../shared/ipc-api").ProjectsChangeEvent) => void,
): () => void {
  return resolveRendererTransport().subscribeProjectChanges(callback);
}

export function subscribeCodexHostMessages(
  callback: (message: import("./types").CodexHostMessage) => void,
): () => void {
  return resolveRendererTransport().subscribeCodexHostMessages(callback);
}

export function subscribeCodexRendererClientRequests(
  callback: (
    message: import("./types").CodexRendererClientRequestMessage,
  ) => void,
): () => void {
  return resolveRendererTransport().subscribeCodexRendererClientRequests(
    callback,
  );
}

export function subscribeDesktopNotificationActions(
  callback: (
    payload: import("./types").DesktopNotificationActionPayload & {
      conversationId: string | null;
      requestId: string | null;
    },
  ) => void,
): () => void {
  return resolveRendererTransport().subscribeDesktopNotificationActions(
    callback,
  );
}

export function subscribeGitBranchChanges(
  callback: (event: { cwd: string }) => void,
): () => void {
  return resolveRendererTransport().subscribeGitBranchChanges(callback);
}

export function subscribeAppUpdateStatus(
  callback: (status: import("./types").AppUpdateStatus) => void,
): () => void {
  return resolveRendererTransport().subscribeAppUpdateStatus(callback);
}

export function subscribeCommandKeymapChanges(
  callback: (
    state: import("../../shared/command-keybindings").CommandKeymapState,
  ) => void,
): () => void {
  return resolveRendererTransport().subscribeCommandKeymapChanges(callback);
}

export function subscribeCommandPaletteThreadIndexUpdates(
  callback: (
    event: import("./types").CommandPaletteThreadIndexUpdatedEvent,
  ) => void,
): () => void {
  return resolveRendererTransport().subscribeCommandPaletteThreadIndexUpdates(
    callback,
  );
}

export function subscribeCodexScheduledAutomationChanges(
  callback: (
    event: import("./types").CodexScheduledAutomationChangedEvent,
  ) => void,
): () => void {
  return resolveRendererTransport().subscribeCodexScheduledAutomationChanges(
    callback,
  );
}

export function subscribeCodexAutomationRunsUpdates(
  callback: (event: import("./types").CodexAutomationRunsUpdatedEvent) => void,
): () => void {
  return resolveRendererTransport().subscribeCodexAutomationRunsUpdates(
    callback,
  );
}

export function subscribeCrossWindowDragActiveChanges(
  callback: (
    preview:
      import("../../shared/cross-window-drag").CrossWindowDragPreview | null,
  ) => void,
): () => void {
  return resolveRendererTransport().subscribeCrossWindowDragActiveChanges(
    callback,
  );
}

export function subscribeCrossWindowDragSourceResults(
  callback: (
    result: import("../../shared/cross-window-drag").CrossWindowDragSourceResult,
  ) => void,
): () => void {
  return resolveRendererTransport().subscribeCrossWindowDragSourceResults(
    callback,
  );
}

export function getWindowFocusState(): Promise<boolean> {
  return resolveRendererTransport().getWindowFocusState();
}

export function subscribeWindowFocusChanges(
  callback: (isFocused: boolean) => void,
): () => void {
  return resolveRendererTransport().subscribeWindowFocusChanges(callback);
}
