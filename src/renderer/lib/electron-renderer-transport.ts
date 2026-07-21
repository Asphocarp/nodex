import type {
  AppUpdateStatus,
  CodexEvent,
  CodexHostMessage,
  CodexProtocolRequestId,
  CodexRendererClientRequestMessage,
  DesktopNotificationActionPayload,
} from "./types";
import {
  COMMAND_KEYBINDINGS_CHANGED_CHANNEL,
  type CommandKeymapState,
} from "../../shared/command-keybindings";
import type {
  BoardChangeEvent,
  PersistedAtomEvent,
  ProjectSessionsChangeEvent,
  ProjectsChangeEvent,
} from "../../shared/ipc-api";
import type { DatabaseChangeEvent } from "../../shared/database-events";
import type { PageTargetChangedEvent } from "../../shared/page-target-events";
import {
  createElectronDocumentSyncAdapter,
  createElectronLibraryDocumentSyncAdapter,
} from "./electron-document-sync-adapter";
import { createElectronCanvasSceneSyncAdapter } from "./electron-canvas-scene-sync-adapter";
import type {
  LibraryOwnedDocumentDescriptor,
  OwnedDocumentDescriptor,
} from "../../shared/block-documents/contracts";
import type { DocumentSyncCommandResult } from "../../shared/block-documents/document-sync";
import type {
  DocumentMutationRequest,
  DocumentOperationCommandResult,
} from "../../shared/block-documents/document-operations";
import type { AdditionalDocumentCommandResult } from "../../shared/additional-document-commands";
import type { PublicAdditionalDocumentCommandRequest } from "../../shared/additional-document-command-transport";
import type { BlockTransferCommandResult } from "../../shared/block-transfer";
import type { PublicBlockTransferIntent } from "../../shared/block-transfer-transport";
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

export type ElectronRendererBridge = NonNullable<Window["api"]>;

export function createElectronRendererTransport(
  bridge: ElectronRendererBridge,
) {
  return {
    kind: "electron" as const,
    readPageLifecyclePreflight(projectId: string, pageId: string) {
      return bridge.invoke(
        "pages:lifecycle:preflight",
        projectId,
        pageId,
      ) as Promise<PageLifecyclePreflightResultV2>;
    },
    mutatePageLifecycle(
      projectId: string,
      request: PageLifecycleMutationRequestV2,
    ) {
      return bridge.invoke(
        "pages:lifecycle:apply",
        projectId,
        request,
      ) as Promise<PageLifecycleMutationCommandResultV2>;
    },
    listPageHistory(request: ListPageHistoryRequest) {
      return bridge.invoke(
        "pages:history:list",
        request,
      ) as Promise<PageHistoryCommandResult>;
    },
    getOwnedDocumentDescriptor(projectId: string, ownerBlockId: string) {
      return bridge.invoke(
        "block-document:owned:get",
        projectId,
        ownerBlockId,
      ) as Promise<OwnedDocumentDescriptor>;
    },
    prepareOwnedBlockDocument(projectId: string, ownerBlockId: string) {
      return bridge.invoke(
        "block-document:owned:prepare",
        projectId,
        ownerBlockId,
      ) as Promise<DocumentSyncCommandResult<OwnedDocumentDescriptor>>;
    },
    prepareLibraryOwnedBlockDocument(ownerBlockId: string) {
      return bridge.invoke(
        "library-block-document:owned:prepare",
        ownerBlockId,
      ) as Promise<DocumentSyncCommandResult<LibraryOwnedDocumentDescriptor>>;
    },
    createDocumentSyncAdapter(projectId: string) {
      return createElectronDocumentSyncAdapter(bridge, projectId);
    },
    createLibraryDocumentSyncAdapter() {
      return createElectronLibraryDocumentSyncAdapter(bridge);
    },
    createCanvasSceneSyncAdapter(projectId: string) {
      return createElectronCanvasSceneSyncAdapter(bridge, projectId);
    },
    mutateDocument(
      projectId: string,
      documentId: string,
      request: DocumentMutationRequest,
    ) {
      return bridge.invoke(
        "block-documents:mutate",
        projectId,
        documentId,
        request,
      ) as Promise<DocumentOperationCommandResult>;
    },
    applyAdditionalDocumentCommand(
      projectId: string,
      request: PublicAdditionalDocumentCommandRequest,
    ) {
      return bridge.invoke(
        "block-documents:command",
        projectId,
        request,
      ) as Promise<AdditionalDocumentCommandResult>;
    },
    transferBlocks(
      projectId: string,
      intent: PublicBlockTransferIntent,
    ) {
      return bridge.invoke(
        "blocks:transfer",
        projectId,
        intent,
      ) as Promise<BlockTransferCommandResult>;
    },
    createDocumentVersionCheckpoint(
      projectId: string,
      documentId: string,
      request: CreateDocumentVersionCheckpoint,
    ) {
      return bridge.invoke(
        "block-documents:history:checkpoint",
        projectId,
        documentId,
        request,
      ) as Promise<DocumentHistoryCommandResult<CreatedDocumentVersionSummary>>;
    },
    listDocumentVersions(request: ListDocumentVersions) {
      return bridge.invoke(
        "block-documents:history:list",
        request,
      ) as Promise<
        DocumentHistoryCommandResult<readonly DocumentVersionSummary[]>
      >;
    },
    getDocumentVersion(request: GetDocumentVersion) {
      return bridge.invoke(
        "block-documents:history:get",
        request,
      ) as Promise<DocumentHistoryCommandResult<DocumentVersionDetail>>;
    },
    restoreDocumentVersion(
      projectId: string,
      documentId: string,
      request: PrepareDocumentVersionRestore,
    ) {
      return bridge.invoke(
        "block-documents:history:restore",
        projectId,
        documentId,
        request,
      ) as Promise<DocumentOperationCommandResult>;
    },
    invoke(channel: string, ...args: unknown[]) {
      return bridge.invoke(channel, ...args);
    },
    subscribeBoardChanges(
      projectId: string,
      callback: (event: BoardChangeEvent) => void,
    ) {
      return bridge.on("board-changed", (...args: unknown[]) => {
        const payload = args[0] as BoardChangeEvent | undefined;
        if (!payload || payload.projectId !== projectId) return;
        callback(payload);
      });
    },
    subscribePageTargetChanges(
      projectId: string,
      callback: (event: PageTargetChangedEvent) => void,
    ) {
      return bridge.on("page-target-changed", (...args: unknown[]) => {
        const payload = args[0] as PageTargetChangedEvent | undefined;
        if (!payload) return;
        callback(payload);
      });
    },
    subscribePageOwnershipPathChanges(
      _projectId: string,
      callback: (
        event: import("../../shared/page-ownership-path-events").PageOwnershipPathsChangedEvent,
      ) => void,
    ) {
      return bridge.on("page-ownership-paths-changed", (...args: unknown[]) => {
        const payload = args[0] as
          | import("../../shared/page-ownership-path-events").PageOwnershipPathsChangedEvent
          | undefined;
        if (!payload) return;
        callback(payload);
      });
    },
    subscribeDatabaseChanges(
      projectId: string,
      callback: (event: DatabaseChangeEvent) => void,
    ) {
      return bridge.on("database-changed", (...args: unknown[]) => {
        const payload = args[0] as DatabaseChangeEvent | undefined;
        if (!payload || payload.projectId !== projectId) return;
        callback(payload);
      });
    },
    subscribeLibraryChanges(
      callback: (
        event: import("../../shared/library-events").LibraryNavigationChangedEvent,
      ) => void,
    ) {
      return bridge.on("library-navigation-changed", (...args: unknown[]) => {
        const payload = args[0] as
          | import("../../shared/library-events").LibraryNavigationChangedEvent
          | undefined;
        if (!payload) return;
        callback(payload);
      });
    },
    subscribeProjectSessionChanges(
      projectId: string | null,
      callback: (event: ProjectSessionsChangeEvent) => void,
    ) {
      return bridge.on("project-sessions-changed", (...args: unknown[]) => {
        const payload = args[0] as ProjectSessionsChangeEvent | undefined;
        if (!payload || payload.projectId !== projectId) return;
        callback(payload);
      });
    },
    subscribeProjectChanges(callback: (event: ProjectsChangeEvent) => void) {
      return bridge.on("projects-changed", (...args: unknown[]) => {
        const payload = args[0] as ProjectsChangeEvent | undefined;
        if (!payload) return;
        callback(payload);
      });
    },
    subscribeCodexHostMessages(callback: (message: CodexHostMessage) => void) {
      return bridge.on("codex:host-message", (...args: unknown[]) => {
        const payload = args[0] as CodexHostMessage | undefined;
        if (!payload) return;
        callback(payload);
      });
    },
    subscribeCodexEvents(callback: (event: CodexEvent) => void) {
      return bridge.on("codex:event", (...args: unknown[]) => {
        const payload = args[0] as CodexEvent | undefined;
        if (!payload || typeof payload.type !== "string") return;
        callback(payload);
      });
    },
    subscribeCodexRendererClientRequests(
      callback: (message: CodexRendererClientRequestMessage) => void,
    ) {
      return bridge.on(
        "codex:renderer-client:request",
        (...args: unknown[]) => {
          const payload = args[0] as
            CodexRendererClientRequestMessage | undefined;
          if (
            !payload ||
            typeof payload.requestId !== "string" ||
            typeof payload.method !== "string"
          )
            return;
          callback(payload);
        },
      );
    },
    subscribeDesktopNotificationActions(
      callback: (
        message: DesktopNotificationActionPayload & {
          conversationId: string | null;
          requestId: CodexProtocolRequestId | null;
          approvalKind: import("./types").CodexApprovalKind | null;
        },
      ) => void,
    ) {
      return bridge.on("desktop-notification:action", (...args: unknown[]) => {
        const payload = args[0] as
          | (DesktopNotificationActionPayload & {
              conversationId?: string | null;
              requestId?: CodexProtocolRequestId | null;
              approvalKind?: import("./types").CodexApprovalKind | null;
            })
          | undefined;
        if (
          !payload ||
          typeof payload.notificationId !== "string" ||
          typeof payload.actionType !== "string"
        ) {
          return;
        }
        if (
          payload.requestId !== undefined
          && payload.requestId !== null
          && typeof payload.requestId !== "string"
          && typeof payload.requestId !== "number"
        ) {
          return;
        }
        if (
          payload.approvalKind !== undefined
          && payload.approvalKind !== null
          && payload.approvalKind !== "command"
          && payload.approvalKind !== "file"
        ) {
          return;
        }
        callback({
          ...payload,
          conversationId: payload.conversationId ?? null,
          requestId: payload.requestId ?? null,
          approvalKind: payload.approvalKind ?? null,
        });
      });
    },
    subscribeGitBranchChanges(callback: (event: { cwd: string }) => void) {
      return bridge.on("git:branch:changed", (...args: unknown[]) => {
        const payload = args[0] as { cwd?: string } | undefined;
        if (!payload || typeof payload.cwd !== "string") return;
        callback({ cwd: payload.cwd });
      });
    },
    subscribeGitReviewLiveQueries(
      callback: (
        event: import("../../shared/types").GitReviewLiveEvent,
      ) => void,
    ) {
      return bridge.on("git:live-query:event", (...args: unknown[]) => {
        const payload = args[0] as
          | import("../../shared/types").GitReviewLiveEvent
          | undefined;
        if (!payload || typeof payload.subscriptionId !== "string") return;
        callback(payload);
      });
    },
    subscribeAppUpdateStatus(callback: (status: AppUpdateStatus) => void) {
      return bridge.on("app:update-status", (...args: unknown[]) => {
        const payload = args[0] as AppUpdateStatus | undefined;
        if (!payload || typeof payload.status !== "string") return;
        callback(payload);
      });
    },
    subscribeCommandKeymapChanges(
      callback: (state: CommandKeymapState) => void,
    ) {
      return bridge.on(
        COMMAND_KEYBINDINGS_CHANGED_CHANNEL,
        (...args: unknown[]) => {
          const payload = args[0] as CommandKeymapState | undefined;
          if (
            !payload ||
            payload.version !== 1 ||
            !Array.isArray(payload.entries)
          )
            return;
          callback(payload);
        },
      );
    },
    subscribeCodexScheduledAutomationChanges(
      callback: (
        event: import("./types").CodexScheduledAutomationChangedEvent,
      ) => void,
    ) {
      return bridge.on(
        "codex:scheduled-automations:changed",
        (...args: unknown[]) => {
          const payload = args[0] as
            import("./types").CodexScheduledAutomationChangedEvent | undefined;
          if (!payload || typeof payload.automationId !== "string") return;
          callback(payload);
        },
      );
    },
    subscribeCodexAutomationRunsUpdates(
      callback: (
        event: import("./types").CodexAutomationRunsUpdatedEvent,
      ) => void,
    ) {
      return bridge.on(
        "codex:automation-runs:updated",
        (...args: unknown[]) => {
          const payload = args[0] as
            import("./types").CodexAutomationRunsUpdatedEvent | undefined;
          if (!payload || typeof payload.reason !== "string") return;
          callback(payload);
        },
      );
    },
    subscribeCodexHooksChanged(
      callback: (
        event: import("../../shared/codex-hooks").CodexHooksChangedEvent,
      ) => void,
    ) {
      return bridge.on("codex:hooks:changed", (...args: unknown[]) => {
        const payload = args[0] as
          | import("../../shared/codex-hooks").CodexHooksChangedEvent
          | undefined;
        if (!payload || typeof payload.hostId !== "string") return;
        callback(payload);
      });
    },
    subscribeCodexPendingWorktreesChanged(
      callback: (
        event: import("../../shared/codex-pending-worktree").CodexPendingWorktreesChangedEvent,
      ) => void,
    ) {
      return bridge.on("codex:pending-worktrees:changed", (...args: unknown[]) => {
        const payload = args[0];
        if (!Array.isArray(payload)) return;
        callback(payload as import("../../shared/codex-pending-worktree").CodexPendingWorktreesChangedEvent);
      });
    },
    subscribeCodexPendingWorktreeWarnings(
      callback: (
        event: import("../../shared/codex-pending-worktree").CodexPendingWorktreeWarningEvent,
      ) => void,
    ) {
      return bridge.on("codex:pending-worktree:warning", (...args: unknown[]) => {
        const payload = args[0] as
          | import("../../shared/codex-pending-worktree").CodexPendingWorktreeWarningEvent
          | undefined;
        if (!payload || payload.kind !== "heartbeat-automation-create-failed") return;
        callback(payload);
      });
    },
    subscribePersistedAtomUpdates(callback: (update: PersistedAtomEvent) => void) {
      return bridge.on("persisted-atom:updated", (...args: unknown[]) => {
        const payload = args[0] as PersistedAtomEvent | undefined;
        if (
          !payload
          || typeof payload.key !== "string"
          || typeof payload.mutationId !== "string"
          || typeof payload.revision !== "number"
        ) return;
        callback(payload);
      });
    },
    getWindowFocusState() {
      return bridge.invoke("electron-window:focus:get") as Promise<boolean>;
    },
    subscribeWindowFocusChanges(callback: (isFocused: boolean) => void) {
      return bridge.on(
        "electron-window:focus-changed",
        (...args: unknown[]) => {
          const payload = args[0] as { isFocused?: boolean } | undefined;
          callback(payload?.isFocused === true);
        },
      );
    },
  };
}
