import { browserRendererTransport } from "./browser-renderer-transport";
import {
  createElectronRendererTransport,
  type ElectronRendererBridge,
} from "./electron-renderer-transport";
import type { CommandKeymapState } from "../../shared/command-keybindings";
import type { BoardChangeEvent } from "../../shared/ipc-api";
import type {
  CrossWindowDragPreview,
  CrossWindowDragSourceResult,
} from "../../shared/cross-window-drag";

export interface RendererTransport {
  kind: "browser" | "electron";
  getOwnedBlockDocumentDescriptor: (
    projectId: string,
    ownerBlockId: string,
  ) => Promise<
    import("../../shared/block-documents/contracts").OwnedBlockDocumentDescriptor
  >;
  prepareOwnedBlockDocument: (
    projectId: string,
    ownerBlockId: string,
  ) => Promise<
    import("../../shared/block-documents/document-sync").DocumentSyncCommandResult<
      import("../../shared/block-documents/contracts").OwnedBlockDocumentDescriptor
    >
  >;
  relocateBlocks: (
    request: import("../../shared/block-documents/relocation-transport").DocumentRelocationRequest,
  ) => Promise<
    import("../../shared/block-documents/contracts").RelocationCommandResult
  >;
  createDocumentSyncAdapter?: (
    projectId: string,
  ) => import("./nodex-y-provider").DocumentSyncAdapter;
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
  subscribeBoardChanges: (
    projectId: string,
    callback: (event: BoardChangeEvent) => void,
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
  subscribeCrossWindowDragActiveChanges: (
    callback: (preview: CrossWindowDragPreview | null) => void,
  ) => () => void;
  subscribeCrossWindowDragSourceResults: (
    callback: (result: CrossWindowDragSourceResult) => void,
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
