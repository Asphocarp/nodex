import type {
  AppUpdateStatus,
  CodexHostMessage,
  CodexRendererClientRequestMessage,
  CommandPaletteThreadIndexUpdatedEvent,
  DesktopNotificationActionPayload,
} from "./types";
import {
  COMMAND_KEYBINDINGS_CHANGED_CHANNEL,
  type CommandKeymapState,
} from "../../shared/command-keybindings";
import type {
  BoardChangeEvent,
  PersistedAtomUpdate,
  ProjectSessionsChangeEvent,
  ProjectsChangeEvent,
} from "../../shared/ipc-api";
import type { DatabaseChangeEvent } from "../../shared/database-events";
import { createElectronDocumentSyncAdapter } from "./electron-document-sync-adapter";
import { createElectronCanvasSceneSyncAdapter } from "./electron-canvas-scene-sync-adapter";
import type {
  OwnedDocumentDescriptor,
  RelocationCommandResult,
} from "../../shared/block-documents/contracts";
import type { DocumentSyncCommandResult } from "../../shared/block-documents/document-sync";
import type { DocumentRelocationRequest } from "../../shared/block-documents/relocation-transport";
import type {
  DocumentMutationRequest,
  DocumentOperationCommandResult,
} from "../../shared/block-documents/document-operations";
import type { AdditionalDocumentCommandResult } from "../../shared/additional-document-commands";
import type { PublicAdditionalDocumentCommandRequest } from "../../shared/additional-document-command-transport";
import type { CardProjectTransferCommandResult } from "../../shared/card-project-transfer";
import type { PublicCardProjectTransferIntent } from "../../shared/card-project-transfer-transport";
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

export type ElectronRendererBridge = NonNullable<Window["api"]>;

export function createElectronRendererTransport(
  bridge: ElectronRendererBridge,
) {
  return {
    kind: "electron" as const,
    readCardLifecyclePreflight(projectId: string, cardId: string) {
      return bridge.invoke(
        "cards:lifecycle:preflight",
        projectId,
        cardId,
      ) as Promise<CardLifecyclePreflightResult>;
    },
    mutateCardLifecycle(
      projectId: string,
      request: CardLifecycleMutationRequest,
    ) {
      return bridge.invoke(
        "cards:lifecycle:apply",
        projectId,
        request,
      ) as Promise<CardLifecycleMutationCommandResult>;
    },
    listCardHistory(request: ListCardHistoryRequest) {
      return bridge.invoke(
        "cards:history:list",
        request,
      ) as Promise<CardHistoryCommandResult>;
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
    createDocumentSyncAdapter(projectId: string) {
      void projectId;
      return createElectronDocumentSyncAdapter(bridge);
    },
    createCanvasSceneSyncAdapter(projectId: string) {
      return createElectronCanvasSceneSyncAdapter(bridge, projectId);
    },
    relocateBlocks(request: DocumentRelocationRequest) {
      return bridge.invoke(
        "document-sync:relocate",
        request,
      ) as Promise<RelocationCommandResult>;
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
    transferCardProject(
      sourceProjectId: string,
      intent: PublicCardProjectTransferIntent,
    ) {
      return bridge.invoke(
        "cards:project-transfer",
        sourceProjectId,
        intent,
      ) as Promise<CardProjectTransferCommandResult>;
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
          requestId: string | null;
        },
      ) => void,
    ) {
      return bridge.on("desktop-notification:action", (...args: unknown[]) => {
        const payload = args[0] as
          | (DesktopNotificationActionPayload & {
              conversationId?: string | null;
              requestId?: string | null;
            })
          | undefined;
        if (
          !payload ||
          typeof payload.notificationId !== "string" ||
          typeof payload.actionType !== "string"
        ) {
          return;
        }
        callback({
          ...payload,
          conversationId: payload.conversationId ?? null,
          requestId: payload.requestId ?? null,
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
    subscribeCommandPaletteThreadIndexUpdates(
      callback: (event: CommandPaletteThreadIndexUpdatedEvent) => void,
    ) {
      return bridge.on(
        "codex:threads:palette:index-updated",
        (...args: unknown[]) => {
          const payload = args[0] as
            CommandPaletteThreadIndexUpdatedEvent | undefined;
          if (!payload || typeof payload.generation !== "number") return;
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
    subscribePersistedAtomUpdates(
      callback: (update: PersistedAtomUpdate) => void,
    ) {
      return bridge.on("persisted-atom:updated", (...args: unknown[]) => {
        const payload = args[0] as PersistedAtomUpdate | undefined;
        if (!payload || typeof payload.key !== "string") return;
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
