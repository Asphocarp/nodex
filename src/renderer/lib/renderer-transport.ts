import { browserRendererTransport } from "./browser-renderer-transport";
import {
  createElectronRendererTransport,
  type ElectronRendererBridge,
} from "./electron-renderer-transport";
import type { CommandKeymapState } from "../../shared/command-keybindings";
import type { BoardChangeEvent } from "../../shared/ipc-api";
import type { DatabaseChangeEvent } from "../../shared/database-events";
import type { PageTargetChangedEvent } from "../../shared/page-target-events";

export interface RendererTransport {
  kind: "browser" | "electron";
  readPageLifecyclePreflight: (
    projectId: string,
    pageId: string,
  ) => Promise<
    import("../../shared/page-lifecycle-v2-runtime").PageLifecyclePreflightResultV2
  >;
  mutatePageLifecycle: (
    projectId: string,
    request: import("../../shared/page-lifecycle-v2").PageLifecycleMutationRequestV2,
  ) => Promise<
    import("../../shared/page-lifecycle-v2").PageLifecycleMutationCommandResultV2
  >;
  listPageHistory: (
    request: import("../../shared/page-history").ListPageHistoryRequest,
  ) => Promise<
    import("../../shared/page-history-transport").PageHistoryCommandResult
  >;
  getOwnedDocumentDescriptor: (
    projectId: string,
    ownerBlockId: string,
  ) => Promise<
    import("../../shared/block-documents/contracts").OwnedDocumentDescriptor
  >;
  prepareOwnedBlockDocument: (
    projectId: string,
    ownerBlockId: string,
  ) => Promise<
    import("../../shared/block-documents/document-sync").DocumentSyncCommandResult<
      import("../../shared/block-documents/contracts").OwnedDocumentDescriptor
    >
  >;
  prepareLibraryOwnedBlockDocument: (
    ownerBlockId: string,
  ) => Promise<
    import("../../shared/block-documents/document-sync").DocumentSyncCommandResult<
      import("../../shared/block-documents/contracts").LibraryOwnedDocumentDescriptor
    >
  >;
  mutateDocument: (
    projectId: string,
    documentId: string,
    request: import("../../shared/block-documents/document-operations").DocumentMutationRequest,
  ) => Promise<
    import("../../shared/block-documents/document-operations").DocumentOperationCommandResult
  >;
  applyAdditionalDocumentCommand: (
    projectId: string,
    request: import("../../shared/additional-document-command-transport").PublicAdditionalDocumentCommandRequest,
  ) => Promise<
    import("../../shared/additional-document-commands").AdditionalDocumentCommandResult
  >;
  transferBlocks: (
    projectId: string,
    intent: import("../../shared/block-transfer-transport").PublicBlockTransferIntent,
  ) => Promise<
    import("../../shared/block-transfer").BlockTransferCommandResult
  >;
  createDocumentVersionCheckpoint: (
    projectId: string,
    documentId: string,
    request: import("../../shared/block-documents/document-history").CreateDocumentVersionCheckpoint,
  ) => Promise<
    import("../../shared/block-documents/document-history-transport").DocumentHistoryCommandResult<
      import("../../shared/block-documents/document-history").CreatedDocumentVersionSummary
    >
  >;
  listDocumentVersions: (
    request: import("../../shared/block-documents/document-history").ListDocumentVersions,
  ) => Promise<
    import("../../shared/block-documents/document-history-transport").DocumentHistoryCommandResult<
      readonly import("../../shared/block-documents/document-history").DocumentVersionSummary[]
    >
  >;
  getDocumentVersion: (
    request: import("../../shared/block-documents/document-history").GetDocumentVersion,
  ) => Promise<
    import("../../shared/block-documents/document-history-transport").DocumentHistoryCommandResult<
      import("../../shared/block-documents/document-history").DocumentVersionDetail
    >
  >;
  restoreDocumentVersion: (
    projectId: string,
    documentId: string,
    request: import("../../shared/block-documents/document-history").PrepareDocumentVersionRestore,
  ) => Promise<
    import("../../shared/block-documents/document-operations").DocumentOperationCommandResult
  >;
  createDocumentSyncAdapter?: (
    projectId: string,
  ) => import("./nodex-y-provider").DocumentSyncAdapter;
  createLibraryDocumentSyncAdapter?: () =>
    import("./nodex-y-provider").DocumentSyncAdapter;
  createCanvasSceneSyncAdapter?: (
    projectId: string,
  ) => import("./canvas-scene-provider").CanvasSceneSyncAdapter;
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
  subscribeBoardChanges: (
    projectId: string,
    callback: (event: BoardChangeEvent) => void,
  ) => () => void;
  subscribePageTargetChanges: (
    projectId: string,
    callback: (event: PageTargetChangedEvent) => void,
  ) => () => void;
  subscribePageOwnershipPathChanges: (
    projectId: string,
    callback: (
      event: import("../../shared/page-ownership-path-events").PageOwnershipPathsChangedEvent,
    ) => void,
  ) => () => void;
  subscribeDatabaseChanges: (
    projectId: string,
    callback: (event: DatabaseChangeEvent) => void,
  ) => () => void;
  subscribeLibraryChanges?: (
    callback: (
      event: import("../../shared/library-events").LibraryNavigationChangedEvent,
    ) => void,
  ) => () => void;
  subscribeProjectSessionChanges: (
    projectId: string | null,
    callback: (
      event: import("../../shared/ipc-api").ProjectSessionsChangeEvent,
    ) => void,
  ) => () => void;
  subscribeProjectChanges: (
    callback: (
      event: import("../../shared/ipc-api").ProjectsChangeEvent,
    ) => void,
  ) => () => void;
  subscribeCodexHostMessages: (
    callback: (message: import("./types").CodexHostMessage) => void,
  ) => () => void;
  subscribeCodexEvents: (
    callback: (event: import("./types").CodexEvent) => void,
  ) => () => void;
  subscribeCodexRendererClientRequests: (
    callback: (
      message: import("./types").CodexRendererClientRequestMessage,
    ) => void,
  ) => () => void;
  subscribeDesktopNotificationActions: (
    callback: (
      payload: import("./types").DesktopNotificationActionPayload & {
        conversationId: string | null;
        requestId: import("./types").CodexProtocolRequestId | null;
        approvalKind: import("./types").CodexApprovalKind | null;
      },
    ) => void,
  ) => () => void;
  subscribeGitBranchChanges: (
    callback: (event: { cwd: string }) => void,
  ) => () => void;
  subscribeGitReviewLiveQueries: (
    callback: (
      event: import("../../shared/types").GitReviewLiveEvent,
    ) => void,
  ) => () => void;
  subscribeAppUpdateStatus: (
    callback: (status: import("./types").AppUpdateStatus) => void,
  ) => () => void;
  subscribeCommandKeymapChanges: (
    callback: (state: CommandKeymapState) => void,
  ) => () => void;
  subscribeCommandPaletteThreadIndexUpdates: (
    callback: (
      event: import("../../shared/types").CommandPaletteThreadIndexUpdatedEvent,
    ) => void,
  ) => () => void;
  subscribeCodexScheduledAutomationChanges: (
    callback: (
      event: import("../../shared/types").CodexScheduledAutomationChangedEvent,
    ) => void,
  ) => () => void;
  subscribeCodexAutomationRunsUpdates: (
    callback: (
      event: import("../../shared/types").CodexAutomationRunsUpdatedEvent,
    ) => void,
  ) => () => void;
  subscribeCodexHooksChanged: (
    callback: (event: import("../../shared/codex-hooks").CodexHooksChangedEvent) => void,
  ) => () => void;
  subscribeCodexPendingWorktreesChanged: (
    callback: (event: import("../../shared/codex-pending-worktree").CodexPendingWorktreesChangedEvent) => void,
  ) => () => void;
  subscribeCodexPendingWorktreeWarnings: (
    callback: (event: import("../../shared/codex-pending-worktree").CodexPendingWorktreeWarningEvent) => void,
  ) => () => void;
  subscribePersistedAtomUpdates: (
    callback: (
      update: import("../../shared/ipc-api").PersistedAtomEvent,
    ) => void,
  ) => () => void;
  getWindowFocusState: () => Promise<boolean>;
  subscribeWindowFocusChanges: (
    callback: (isFocused: boolean) => void,
  ) => () => void;
}

const BROWSER_ONLY_INVOKE_CHANNELS = new Set<string>(["asset:resolve-path"]);

function readElectronBridge(): ElectronRendererBridge | null {
  if (typeof window === "undefined") return null;
  return window.api ?? null;
}

export function resolveRendererTransport(): RendererTransport {
  const bridge = readElectronBridge();
  if (!bridge) return browserRendererTransport;
  return createElectronRendererTransport(bridge);
}

export function resolveInvokeTransport(channel: string): RendererTransport {
  if (BROWSER_ONLY_INVOKE_CHANNELS.has(channel)) {
    return browserRendererTransport;
  }

  return resolveRendererTransport();
}
