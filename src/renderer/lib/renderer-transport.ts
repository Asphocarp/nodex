import { browserRendererTransport } from "./browser-renderer-transport";
import {
  createElectronRendererTransport,
  type ElectronRendererBridge,
} from "./electron-renderer-transport";
import type { CommandKeymapState } from "../../shared/command-keybindings";
import type { BoardChangeEvent } from "../../shared/ipc-api";
import type { DatabaseChangeEvent } from "../../shared/database-events";

export interface RendererTransport {
  kind: "browser" | "electron";
  readCardLifecyclePreflight: (
    projectId: string,
    cardId: string,
  ) => Promise<
    import("../../shared/card-lifecycle-runtime").CardLifecyclePreflightResult
  >;
  mutateCardLifecycle: (
    projectId: string,
    request: import("../../shared/card-lifecycle").CardLifecycleMutationRequest,
  ) => Promise<
    import("../../shared/card-lifecycle").CardLifecycleMutationCommandResult
  >;
  listCardHistory: (
    request: import("../../shared/card-history").ListCardHistoryRequest,
  ) => Promise<
    import("../../shared/card-history-transport").CardHistoryCommandResult
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
  relocateBlocks: (
    request: import("../../shared/block-documents/relocation-transport").DocumentRelocationRequest,
  ) => Promise<
    import("../../shared/block-documents/contracts").RelocationCommandResult
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
  transferCardProject: (
    sourceProjectId: string,
    intent: import("../../shared/card-project-transfer-transport").PublicCardProjectTransferIntent,
  ) => Promise<
    import("../../shared/card-project-transfer").CardProjectTransferCommandResult
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
  createCanvasSceneSyncAdapter?: (
    projectId: string,
  ) => import("./canvas-scene-provider").CanvasSceneSyncAdapter;
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
  subscribeBoardChanges: (
    projectId: string,
    callback: (event: BoardChangeEvent) => void,
  ) => () => void;
  subscribeDatabaseChanges: (
    projectId: string,
    callback: (event: DatabaseChangeEvent) => void,
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
  subscribeCodexRendererClientRequests: (
    callback: (
      message: import("./types").CodexRendererClientRequestMessage,
    ) => void,
  ) => () => void;
  subscribeDesktopNotificationActions: (
    callback: (
      payload: import("./types").DesktopNotificationActionPayload & {
        conversationId: string | null;
        requestId: string | null;
      },
    ) => void,
  ) => () => void;
  subscribeGitBranchChanges: (
    callback: (event: { cwd: string }) => void,
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
  subscribePersistedAtomUpdates: (
    callback: (
      update: import("../../shared/ipc-api").PersistedAtomUpdate,
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
