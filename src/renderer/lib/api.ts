import {
  resolveInvokeTransport,
  resolveRendererTransport,
} from "./renderer-transport";
import type { IpcApi } from "../../shared/ipc-api";
import type { ContentAccessContext } from "../../shared/content-access-context";
import {
  isCursorRejectionCode,
  type CoreReadError,
  type CoreReadResult,
} from "../../shared/core-read-result";
import type {
  DatabaseViewGroupsInput,
  DatabaseViewGroupsSnapshot,
  DatabaseViewWindowInput,
  DatabaseViewWindowSnapshot,
  LibraryDatabaseViewGroupsSnapshot,
  LibraryDatabaseViewWindowSnapshot,
} from "../../shared/database-views";
import type { DocumentSyncAdapter } from "./nodex-y-provider";
import type { CanvasSceneSyncAdapter } from "./canvas-scene-provider";
import type {
  CanvasSceneCompactionCommandResult,
  CanvasSceneCompactionReadCommandResult,
  CanvasSceneCompactionReadRequest,
  CanvasSceneCompactionRequest,
} from "../../shared/block-documents/canvas-scene-maintenance";
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
import { GitWorkerClient } from "./git-worker-client";
import { admitLocalCommitApply } from "./local-commit-ingress";

let gitWorkerClient: GitWorkerClient | null = null;

export function getGitWorkerClient(): GitWorkerClient {
  if (gitWorkerClient) return gitWorkerClient;
  const transport = resolveRendererTransport();
  gitWorkerClient = new GitWorkerClient({
    send: async (message) => await transport.sendGitWorkerMessage(message),
    subscribe: (listener) => transport.subscribeGitWorkerMessages(listener),
  });
  return gitWorkerClient;
}

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
  const transport = resolveInvokeTransport();
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

export function readCanvasSceneCompaction(
  request: CanvasSceneCompactionReadRequest,
): Promise<CanvasSceneCompactionReadCommandResult> {
  return invoke("canvas-scene:compaction:read", request);
}

export function compactCanvasScene(
  request: CanvasSceneCompactionRequest,
): Promise<CanvasSceneCompactionCommandResult> {
  return invoke("canvas-scene:compaction:apply", request).then(async (result) => {
    if (result.ok) await admitLocalCommitApply(result.localCommit);
    return result;
  });
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

export async function mutateDocument(
  projectId: string,
  documentId: string,
  request: DocumentMutationRequest,
): Promise<DocumentOperationCommandResult> {
  const result = await resolveRendererTransport().mutateDocument(
    projectId,
    documentId,
    request,
  );
  if (result.ok) await admitLocalCommitApply(result.localCommit);
  return result;
}

export async function applyAdditionalDocumentCommand(
  projectId: string,
  request: PublicAdditionalDocumentCommandRequest,
): Promise<AdditionalDocumentCommandResult> {
  const result = await resolveRendererTransport().applyAdditionalDocumentCommand(
    projectId,
    request,
  );
  if (result.ok) await admitLocalCommitApply(result.localCommit);
  return result;
}

export async function transferBlocks(
  projectId: string,
  intent: PublicBlockTransferIntent,
): Promise<BlockTransferCommandResult> {
  const result = await resolveRendererTransport().transferBlocks(projectId, intent);
  if (result.ok) await admitLocalCommitApply(result.localCommit);
  return result;
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

export async function restoreDocumentVersion(
  projectId: string,
  documentId: string,
  request: PrepareDocumentVersionRestore,
): Promise<DocumentOperationCommandResult> {
  const result = await resolveRendererTransport().restoreDocumentVersion(
    projectId,
    documentId,
    request,
  );
  if (result.ok) await admitLocalCommitApply(result.localCommit);
  return result;
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

export async function mutateBlockProperties(
  projectId: string,
  request: BlockPropertyMutationRequestV2,
): Promise<BlockPropertyMutationCommandResultV2> {
  const result = await invoke("block-properties:mutate", projectId, request);
  if (result.ok) await admitLocalCommitApply(result.localCommit);
  return result;
}

export async function mutateLibraryBlockProperties(
  request: LibraryBlockPropertyMutationRequestV2,
): Promise<LibraryBlockPropertyMutationCommandResultV2> {
  const result = await invoke("library-block-properties:mutate", request);
  if (result.ok) await admitLocalCommitApply(result.localCommit);
  return result;
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

export async function mutatePageLifecycle(
  projectId: string,
  request: PageLifecycleMutationRequestV2,
): Promise<PageLifecycleMutationCommandResultV2> {
  const result = await resolveRendererTransport().mutatePageLifecycle(
    projectId,
    request,
  );
  if (result.ok) await admitLocalCommitApply(result.localCommit);
  return result;
}

export function listPageHistory(
  request: ListPageHistoryRequest,
): Promise<PageHistoryCommandResult> {
  return resolveRendererTransport().listPageHistory(request);
}

/**
 * Typed failure of a Core-backed read channel. `code` is the Core error code
 * (`revision_conflict`, `invalid_input`, …); consumers classify with it and
 * with `isCursorRejection`, never by matching message text.
 */
export class CoreApiError extends Error {
  constructor(readonly detail: CoreReadError) {
    super(detail.message);
    this.name = "CoreApiError";
  }

  get code(): string {
    return this.detail.code;
  }

  get retryable(): boolean {
    return this.detail.retryable;
  }

  isCursorRejection(options: { readonly requestHadCursor: boolean }): boolean {
    return isCursorRejectionCode(this.detail.code, options);
  }
}

type CoreReadChannel = {
  [Channel in keyof IpcApi]: IpcApi[Channel]["result"] extends CoreReadResult<unknown>
    ? Channel
    : never;
}[keyof IpcApi];

type CoreReadChannelValue<Channel extends CoreReadChannel> =
  IpcApi[Channel]["result"] extends CoreReadResult<infer Value> ? Value : never;

/** Invokes a Core-backed read channel and unwraps its typed error envelope. */
export async function invokeCoreRead<Channel extends CoreReadChannel>(
  channel: Channel,
  ...args: IpcApi[Channel]["args"]
): Promise<CoreReadChannelValue<Channel>> {
  const result = (await invoke(
    channel,
    ...args,
  )) as CoreReadResult<CoreReadChannelValue<Channel>>;
  if (result.ok) return result.value;
  throw new CoreApiError(result.error);
}

export function readDatabaseViewWindow(
  projectId: string,
  input: DatabaseViewWindowInput,
): Promise<DatabaseViewWindowSnapshot> {
  return invokeCoreRead("database:view-window:get", projectId, input);
}

export function readDatabaseViewGroups(
  projectId: string,
  input: DatabaseViewGroupsInput,
): Promise<DatabaseViewGroupsSnapshot> {
  return invokeCoreRead("database:view-groups:get", projectId, input);
}

export function readLibraryDatabaseViewWindow(
  input: DatabaseViewWindowInput & (
    | { readonly databaseViewId: string }
    | { readonly databaseId: string }
  ),
): Promise<LibraryDatabaseViewWindowSnapshot> {
  return invokeCoreRead("library-database:view-window:get", input);
}

export function readLibraryDatabaseViewGroups(
  input: DatabaseViewGroupsInput & (
    | { readonly databaseViewId: string }
    | { readonly databaseId: string }
  ),
): Promise<LibraryDatabaseViewGroupsSnapshot> {
  return invokeCoreRead("library-database:view-groups:get", input);
}

export function readDatabaseModule(
  projectId: string,
  request: DatabaseModuleReadRequestV2,
): Promise<DatabaseModuleReadResultV2> {
  return invoke("database-module:read", projectId, request);
}

export async function applyDatabaseModule(
  projectId: string,
  request: DatabaseApplyV2,
): Promise<DatabaseApplyResultV2> {
  const result = await invoke("database-module:apply", projectId, request);
  if (result.ok) await admitLocalCommitApply(result.localCommit);
  return result;
}

export function readLibraryModule(
  accessContext: ContentAccessContext,
  request: LibraryModuleReadRequest,
): Promise<LibraryModuleReadResult> {
  return invoke("library-module:read", accessContext, request);
}

export async function applyLibraryModule(
  accessContext: ContentAccessContext,
  request: LibraryModuleApplyRequest,
): Promise<LibraryModuleApplyResult> {
  const result = await invoke("library-module:apply", accessContext, request);
  if (result.ok) await admitLocalCommitApply(result.localCommit);
  return result;
}

export function readLibraryDatabaseModule(
  request: import("../../shared/database-module-v2").LibraryDatabaseModuleReadRequestV2,
): Promise<import("../../shared/database-module-v2").LibraryDatabaseModuleReadResultV2> {
  return invoke(
    "library-database-module:read",
    request,
  ) as Promise<import("../../shared/database-module-v2").LibraryDatabaseModuleReadResultV2>;
}

export async function applyLibraryDatabaseModule(
  request: import("../../shared/database-module-v2").LibraryDatabaseApplyV2,
): Promise<import("../../shared/database-module-v2").LibraryDatabaseApplyResultV2> {
  const result = await invoke(
    "library-database-module:apply",
    request,
  ) as import("../../shared/database-module-v2").LibraryDatabaseApplyResultV2;
  if (result.ok) await admitLocalCommitApply(result.localCommit);
  return result;
}

export function readPageDetail(
  projectId: string,
  pageId: string,
  minimumCommitSeq?: number,
): Promise<PageDetailResult> {
  return invoke("pages:detail:get", projectId, pageId, minimumCommitSeq);
}

export function readLibraryPageDetail(
  pageId: string,
  minimumCommitSeq?: number,
): Promise<LibraryPageDetailResult> {
  return invoke("library-pages:detail:get", pageId, minimumCommitSeq);
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
  callback: (payload: import("./types").DesktopNotificationActionInvocation) => void,
): () => void {
  return resolveRendererTransport().subscribeDesktopNotificationActions(
    callback,
  );
}

export function subscribeWorkspaceFileChanges(
  callback: (
    event: import("../../shared/types").WorkspaceFileChangedEvent,
  ) => void,
): () => void {
  return resolveRendererTransport().subscribeWorkspaceFileChanges(callback);
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

export function getUserInputAutoResolutionSnapshot(): Promise<
  import("../../shared/codex-user-input-auto-resolution").CodexUserInputAutoResolutionEntry[]
> {
  return resolveRendererTransport().getUserInputAutoResolutionSnapshot();
}

export function recordUserInputAutoResolutionActivity(
  conversationId: string,
): Promise<boolean> {
  return resolveRendererTransport().recordUserInputAutoResolutionActivity(
    conversationId,
  );
}

export function snoozeUserInputAutoResolution(
  target: import("../../shared/codex-user-input-auto-resolution").CodexUserInputAutoResolutionTarget,
): Promise<boolean> {
  return resolveRendererTransport().snoozeUserInputAutoResolution(target);
}

export function subscribeUserInputAutoResolutionChanges(
  callback: (
    change: import("../../shared/codex-user-input-auto-resolution").CodexUserInputAutoResolutionChange,
  ) => void,
): () => void {
  return resolveRendererTransport().subscribeUserInputAutoResolutionChanges(
    callback,
  );
}
