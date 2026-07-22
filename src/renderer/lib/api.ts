import {
  resolveInvokeTransport,
  resolveRendererTransport,
} from "./renderer-transport";
import type { IpcApi } from "../../shared/ipc-api";
import type { DocumentSyncAdapter } from "./nodex-y-provider";
import type { CanvasSceneSyncAdapter } from "./canvas-scene-provider";
import type {
  LibraryOwnedDocumentDescriptor,
  OwnedDocumentDescriptor,
} from "../../shared/block-documents/contracts";
import type { DocumentSyncCommandResult } from "../../shared/block-documents/document-sync";
import type {
  PageTargetReadModel,
  ResolvePageTargetInput,
} from "../../shared/page-targets";
import type {
  PageOwnershipPathReadModel,
  ResolvePageOwnershipPathInput,
} from "../../shared/page-ownership-paths";
import type {
  DatabaseViewReadModel,
  ReadDatabaseViewReferenceInput,
} from "../../shared/database-views";
import type {
  BlockPropertyMutationCommandResultV2,
  BlockPropertyMutationRequestV2,
  LibraryBlockPropertyMutationCommandResultV2,
  LibraryBlockPropertyMutationRequestV2,
} from "../../shared/block-property-mutations-v2";
import type {
  DatabaseApplyResultV2,
  DatabaseApplyV2,
  DatabaseModuleReadRequestV2,
  DatabaseModuleReadResultV2,
} from "../../shared/database-module-v2";
import type {
  LibraryModuleApplyRequest,
  LibraryModuleApplyResult,
  LibraryModuleReadRequest,
  LibraryModuleReadResult,
} from "../../shared/library-module";
import type {
  LibraryPageDetailResult,
  PageDetailResult,
} from "../../shared/page-detail";
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
  PageLifecycleMutationCommandResultV2,
  PageLifecycleMutationRequestV2,
} from "../../shared/page-lifecycle-v2";
import type { PageLifecyclePreflightResultV2 } from "../../shared/page-lifecycle-v2-runtime";
import type { ListPageHistoryRequest } from "../../shared/page-history";
import type { PageHistoryCommandResult } from "../../shared/page-history-transport";
import type { AdditionalDocumentCommandResult } from "../../shared/additional-document-commands";
import type { PublicAdditionalDocumentCommandRequest } from "../../shared/additional-document-command-transport";
import type { BlockTransferCommandResult } from "../../shared/block-transfer";
import type { PublicBlockTransferIntent } from "../../shared/block-transfer-transport";
import type {
  CreatePastedTextAttachmentInput,
  CreatePastedTextAttachmentResult,
  ReadPastedTextAttachmentInput,
  RemovePastedTextAttachmentInput,
} from "../../shared/pasted-text-attachments";

const BROWSER_CODEX_INVOKE_CHANNELS = new Set<string>([
  "codex:sidebar:thread:move",
  "codex:sidebar:project-thread-order:set",
  "codex:sidebar:chats-thread-order:set",
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
    (channel.startsWith("codex:") || channel.startsWith("agent-runtime:")) &&
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

export function createLibraryDocumentSyncAdapter(): DocumentSyncAdapter {
  const createAdapter = resolveRendererTransport().createLibraryDocumentSyncAdapter;
  if (createAdapter) return createAdapter();
  throw new Error("Library Document sync is unavailable for this renderer transport");
}

export function createCanvasSceneSyncAdapter(
  projectId: string,
): CanvasSceneSyncAdapter {
  const transport = resolveRendererTransport();
  const createAdapter = transport.createCanvasSceneSyncAdapter;
  if (createAdapter) return createAdapter(projectId);
  throw new Error("Canvas scene sync is unavailable for this renderer transport");
}

export function getOwnedDocumentDescriptor(
  projectId: string,
  ownerBlockId: string,
): Promise<OwnedDocumentDescriptor> {
  return resolveRendererTransport().getOwnedDocumentDescriptor(
    projectId,
    ownerBlockId,
  );
}

export function prepareOwnedBlockDocument(
  projectId: string,
  ownerBlockId: string,
): Promise<DocumentSyncCommandResult<OwnedDocumentDescriptor>> {
  return resolveRendererTransport().prepareOwnedBlockDocument(
    projectId,
    ownerBlockId,
  );
}

export function prepareLibraryOwnedBlockDocument(
  ownerBlockId: string,
): Promise<DocumentSyncCommandResult<LibraryOwnedDocumentDescriptor>> {
  return resolveRendererTransport().prepareLibraryOwnedBlockDocument(ownerBlockId);
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

export function transferBlocks(
  projectId: string,
  intent: PublicBlockTransferIntent,
): Promise<BlockTransferCommandResult> {
  return resolveRendererTransport().transferBlocks(projectId, intent);
}

export function createPastedTextAttachment(
  input: CreatePastedTextAttachmentInput,
): Promise<CreatePastedTextAttachmentResult> {
  return invoke("codex:pasted-text:create", input);
}

export function readPastedTextAttachment(
  input: ReadPastedTextAttachmentInput,
): Promise<string> {
  return invoke("codex:pasted-text:read", input);
}

export function removePastedTextAttachment(
  input: RemovePastedTextAttachmentInput,
): Promise<void> {
  return invoke("codex:pasted-text:remove", input);
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

export function resolvePageTarget(
  input: ResolvePageTargetInput,
): Promise<PageTargetReadModel | null> {
  return invoke("page-target:resolve", input);
}

export function resolvePageOwnershipPath(
  input: ResolvePageOwnershipPathInput,
): Promise<PageOwnershipPathReadModel | null> {
  return invoke("page-ownership-path:resolve", input);
}

export function readDatabaseViewReference(
  input: ReadDatabaseViewReferenceInput,
): Promise<DatabaseViewReadModel | null> {
  return invoke("database-view:reference:get", input);
}

export function mutateBlockProperties(
  projectId: string,
  request: BlockPropertyMutationRequestV2,
): Promise<BlockPropertyMutationCommandResultV2> {
  return invoke("block-properties:mutate", projectId, request);
}

export function mutateLibraryBlockProperties(
  request: LibraryBlockPropertyMutationRequestV2,
): Promise<LibraryBlockPropertyMutationCommandResultV2> {
  return invoke("library-block-properties:mutate", request);
}

export function readPageLifecyclePreflight(
  projectId: string,
  pageId: string,
): Promise<PageLifecyclePreflightResultV2> {
  return resolveRendererTransport().readPageLifecyclePreflight(
    projectId,
    pageId,
  );
}

export function mutatePageLifecycle(
  projectId: string,
  request: PageLifecycleMutationRequestV2,
): Promise<PageLifecycleMutationCommandResultV2> {
  return resolveRendererTransport().mutatePageLifecycle(projectId, request);
}

export function listPageHistory(
  request: ListPageHistoryRequest,
): Promise<PageHistoryCommandResult> {
  return resolveRendererTransport().listPageHistory(request);
}

export function readDatabaseModule(
  projectId: string,
  request: DatabaseModuleReadRequestV2,
): Promise<DatabaseModuleReadResultV2> {
  return invoke("database-module:read", projectId, request);
}

export function applyDatabaseModule(
  projectId: string,
  request: DatabaseApplyV2,
): Promise<DatabaseApplyResultV2> {
  return invoke("database-module:apply", projectId, request);
}

export function readLibraryModule(
  request: LibraryModuleReadRequest,
): Promise<LibraryModuleReadResult> {
  return invoke("library-module:read", request);
}

export function applyLibraryModule(
  request: LibraryModuleApplyRequest,
): Promise<LibraryModuleApplyResult> {
  return invoke("library-module:apply", request);
}

export function readLibraryDatabaseModule(
  request: import("../../shared/database-module-v2").LibraryDatabaseModuleReadRequestV2,
): Promise<import("../../shared/database-module-v2").LibraryDatabaseModuleReadResultV2> {
  return invoke(
    "library-database-module:read",
    request,
  ) as Promise<import("../../shared/database-module-v2").LibraryDatabaseModuleReadResultV2>;
}

export function applyLibraryDatabaseModule(
  request: import("../../shared/database-module-v2").LibraryDatabaseApplyV2,
): Promise<import("../../shared/database-module-v2").LibraryDatabaseApplyResultV2> {
  return invoke(
    "library-database-module:apply",
    request,
  ) as Promise<import("../../shared/database-module-v2").LibraryDatabaseApplyResultV2>;
}

export function readPageDetail(
  projectId: string,
  pageId: string,
): Promise<PageDetailResult> {
  return invoke("pages:detail:get", projectId, pageId);
}

export function readLibraryPageDetail(
  pageId: string,
): Promise<LibraryPageDetailResult> {
  return invoke("library-pages:detail:get", pageId);
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

export function subscribeLibraryChanges(
  callback: (
    event: import("../../shared/library-events").LibraryNavigationChangedEvent,
  ) => void,
): () => void {
  return resolveRendererTransport().subscribeLibraryChanges?.(callback) ?? (() => {});
}

export function subscribeProjectSessionChanges(
  callback: (
    event: import("../../shared/ipc-api").ProjectSessionsChangeEvent,
  ) => void,
): () => void {
  return resolveRendererTransport().subscribeProjectSessionChanges(callback);
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

export function subscribeCodexEvents(
  callback: (event: import("./types").CodexEvent) => void,
): () => void {
  return resolveRendererTransport().subscribeCodexEvents(callback);
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
      requestId: import("./types").CodexProtocolRequestId | null;
      approvalKind: import("./types").CodexApprovalKind | null;
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

export function subscribeGitReviewLiveQueries(
  callback: (
    event: import("../../shared/types").GitReviewLiveEvent,
  ) => void,
): () => void {
  return resolveRendererTransport().subscribeGitReviewLiveQueries(callback);
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

export function subscribeCodexHooksChanged(
  callback: (
    event: import("../../shared/codex-hooks").CodexHooksChangedEvent,
  ) => void,
): () => void {
  return resolveRendererTransport().subscribeCodexHooksChanged(callback);
}

export function subscribeCodexPendingWorktreesChanged(
  callback: (
    event: import("../../shared/codex-pending-worktree").CodexPendingWorktreesChangedEvent,
  ) => void,
): () => void {
  return resolveRendererTransport().subscribeCodexPendingWorktreesChanged(callback);
}

export function subscribeCodexPendingWorktreeWarnings(
  callback: (
    event: import("../../shared/codex-pending-worktree").CodexPendingWorktreeWarningEvent,
  ) => void,
): () => void {
  return resolveRendererTransport().subscribeCodexPendingWorktreeWarnings(callback);
}

export function getWindowFocusState(): Promise<boolean> {
  return resolveRendererTransport().getWindowFocusState();
}

export function subscribeWindowFocusChanges(
  callback: (isFocused: boolean) => void,
): () => void {
  return resolveRendererTransport().subscribeWindowFocusChanges(callback);
}
