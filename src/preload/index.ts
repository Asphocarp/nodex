import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { AppInitializationStep } from "../shared/app-startup";
import {
  CORE_AUTHORITY_STATUS_CHANNEL,
  GET_CORE_AUTHORITY_STATUS_CHANNEL,
  RELAUNCH_FOR_CORE_AUTHORITY_CHANNEL,
  RETRY_CORE_AUTHORITY_CHANNEL,
  type CoreAuthorityStatus,
} from "../shared/core-authority-status";
import {
  CLOSE_PANEL_TAB_HOST_CHANNEL,
  CYCLE_PANEL_TAB_NEXT_HOST_CHANNEL,
  CYCLE_PANEL_TAB_PREVIOUS_HOST_CHANNEL,
  NAVIGATE_BACK_HOST_CHANNEL,
  NAVIGATE_FORWARD_HOST_CHANNEL,
  OPEN_CONTENT_SEARCH_HOST_CHANNEL,
  REQUEST_NEW_WINDOW_HOST_CHANNEL,
  RENAME_THREAD_HOST_CHANNEL,
  TOGGLE_SIDEBAR_HOST_CHANNEL,
} from "../shared/window-navigation";
import {
  EXECUTE_WORKBENCH_COMMAND_HOST_CHANNEL,
  type WorkbenchCommandInvocation,
} from "../shared/workbench-commands";
import { CLIPBOARD_INSPECT_PASTE_SYNC_CHANNEL } from "../shared/clipboard-paste";
import type {
  ClipboardPasteInspectionResult,
  ClipboardPastePayload,
} from "../shared/types";
import type { CodexDesktopMessageFromView } from "../shared/remote-hosted-pip";
import {
  FILE_PATH_INSPECT_SYNC_CHANNEL,
  MANAGED_ASSET_RESOLVE_PATH_SYNC_CHANNEL,
} from "../shared/preload-file-access";
import {
  GIT_WORKER_MESSAGE_FOR_VIEW_CHANNEL,
  GIT_WORKER_MESSAGE_FROM_VIEW_CHANNEL,
  type GitWorkerMessageForView,
  type GitWorkerMessageFromView,
} from "../shared/git-worker-protocol";
import type { McpAppSandboxHostMessageChannel } from "../shared/mcp-app/mcp-app-sandbox-contract";

// Sandboxed Electron preloads cannot require Rollup's local shared chunks.
// Keep the wire literal type-checked without creating a runtime dependency on
// the guest preload's sandbox contract bundle.
const MCP_APP_SANDBOX_HOST_MESSAGE_CHANNEL: McpAppSandboxHostMessageChannel =
  "nodex:mcp-app-sandbox-host-message";

ipcRenderer.on(MCP_APP_SANDBOX_HOST_MESSAGE_CHANNEL, (event, message) => {
  const targetOrigin = window.location.origin;
  if (targetOrigin === "null") return;
  window.postMessage(message, targetOrigin, event.ports);
});

function resolveManagedAssetPath(source: string): string | null {
  return ipcRenderer.sendSync(
    MANAGED_ASSET_RESOLVE_PATH_SYNC_CHANNEL,
    source,
  ) as string | null;
}

// Multiple editor blocks (toggle-list-inline-view, pageRef) each subscribe to
// board-changed via useKanban, easily exceeding the default limit of 10.
ipcRenderer.setMaxListeners(50);

contextBridge.exposeInMainWorld("api", {
  invoke: (channel: string, ...args: unknown[]) =>
    ipcRenderer.invoke(channel, ...args),

  on: (event: string, callback: (...args: unknown[]) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, ...args: unknown[]) =>
      callback(...args);
    ipcRenderer.on(event, listener);
    return () => {
      ipcRenderer.removeListener(event, listener);
    };
  },
  awaitInitialization: () => ipcRenderer.invoke("app:await-initialization"),
  getCoreAuthorityStatus: () =>
    ipcRenderer.invoke(GET_CORE_AUTHORITY_STATUS_CHANNEL) as Promise<CoreAuthorityStatus>,
  onCoreAuthorityStatus: (
    callback: (status: CoreAuthorityStatus) => void,
  ) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      status: CoreAuthorityStatus,
    ) => callback(status);
    ipcRenderer.on(CORE_AUTHORITY_STATUS_CHANNEL, listener);
    return () => {
      ipcRenderer.removeListener(CORE_AUTHORITY_STATUS_CHANNEL, listener);
    };
  },
  retryCoreAuthority: () => ipcRenderer.invoke(RETRY_CORE_AUTHORITY_CHANNEL),
  relaunchForCoreAuthority: () =>
    ipcRenderer.invoke(RELAUNCH_FOR_CORE_AUTHORITY_CHANNEL),
  onInitializationStep: (callback: (step: AppInitializationStep) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      step: AppInitializationStep,
    ) => callback(step);
    ipcRenderer.on("app:init-step", listener);
    return () => {
      ipcRenderer.removeListener("app:init-step", listener);
    };
  },
  reportInitializationReady: (input: { durationMs: number; outcome: "failed" | "ready" }) => {
    ipcRenderer.send("app:renderer-initialization-finished", input);
  },
  onNavigateBack: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on(NAVIGATE_BACK_HOST_CHANNEL, listener);
    return () => {
      ipcRenderer.removeListener(NAVIGATE_BACK_HOST_CHANNEL, listener);
    };
  },
  onNavigateForward: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on(NAVIGATE_FORWARD_HOST_CHANNEL, listener);
    return () => {
      ipcRenderer.removeListener(NAVIGATE_FORWARD_HOST_CHANNEL, listener);
    };
  },
  onToggleSidebar: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on(TOGGLE_SIDEBAR_HOST_CHANNEL, listener);
    return () => {
      ipcRenderer.removeListener(TOGGLE_SIDEBAR_HOST_CHANNEL, listener);
    };
  },
  onRenameThread: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on(RENAME_THREAD_HOST_CHANNEL, listener);
    return () => {
      ipcRenderer.removeListener(RENAME_THREAD_HOST_CHANNEL, listener);
    };
  },
  onOpenContentSearch: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on(OPEN_CONTENT_SEARCH_HOST_CHANNEL, listener);
    return () => {
      ipcRenderer.removeListener(OPEN_CONTENT_SEARCH_HOST_CHANNEL, listener);
    };
  },
  onCyclePanelTabPrevious: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on(CYCLE_PANEL_TAB_PREVIOUS_HOST_CHANNEL, listener);
    return () => {
      ipcRenderer.removeListener(CYCLE_PANEL_TAB_PREVIOUS_HOST_CHANNEL, listener);
    };
  },
  onCyclePanelTabNext: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on(CYCLE_PANEL_TAB_NEXT_HOST_CHANNEL, listener);
    return () => {
      ipcRenderer.removeListener(CYCLE_PANEL_TAB_NEXT_HOST_CHANNEL, listener);
    };
  },
  onClosePanelTab: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on(CLOSE_PANEL_TAB_HOST_CHANNEL, listener);
    return () => {
      ipcRenderer.removeListener(CLOSE_PANEL_TAB_HOST_CHANNEL, listener);
    };
  },
  onRequestNewWindow: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on(REQUEST_NEW_WINDOW_HOST_CHANNEL, listener);
    return () => {
      ipcRenderer.removeListener(REQUEST_NEW_WINDOW_HOST_CHANNEL, listener);
    };
  },
  onWorkbenchCommand: (callback: (invocation: WorkbenchCommandInvocation) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      invocation: WorkbenchCommandInvocation,
    ) => callback(invocation);
    ipcRenderer.on(EXECUTE_WORKBENCH_COMMAND_HOST_CHANNEL, listener);
    return () => {
      ipcRenderer.removeListener(EXECUTE_WORKBENCH_COMMAND_HOST_CHANNEL, listener);
    };
  },
  requestMicrophonePermission: () => {
    ipcRenderer.send("electron-request-microphone-permission");
  },
  resolveManagedAssetPath,
  inspectPasteClipboard: () =>
    ipcRenderer.sendSync(CLIPBOARD_INSPECT_PASTE_SYNC_CHANNEL) as ClipboardPasteInspectionResult,
  readPasteClipboard: () =>
    ipcRenderer.invoke("clipboard:read-paste") as Promise<ClipboardPastePayload>,
  getPathInfoForFile: (file: File) => {
    try {
      const absolutePath = webUtils.getPathForFile(file);
      if (!absolutePath) return null;

      return ipcRenderer.sendSync(
        FILE_PATH_INSPECT_SYNC_CHANNEL,
        absolutePath,
      ) as ClipboardPasteInspectionResult["items"][number] | null;
    } catch {
      return null;
    }
  },
  getPathForFile: (file: File) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return "";
    }
  },
  sendGitWorkerMessage: (message: GitWorkerMessageFromView) =>
    ipcRenderer.invoke(GIT_WORKER_MESSAGE_FROM_VIEW_CHANNEL, message).then(() => undefined),
  onGitWorkerMessage: (callback: (message: GitWorkerMessageForView) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      message: GitWorkerMessageForView,
    ) => callback(message);
    ipcRenderer.on(GIT_WORKER_MESSAGE_FOR_VIEW_CHANNEL, listener);
    return () => {
      ipcRenderer.removeListener(GIT_WORKER_MESSAGE_FOR_VIEW_CHANNEL, listener);
    };
  },
});

contextBridge.exposeInMainWorld("electronBridge", {
  sendMessageFromView: (message: CodexDesktopMessageFromView) =>
    ipcRenderer.invoke("codex-desktop:message-from-view", message).then(() => undefined),
  showContextMenu: (items: unknown[], options?: unknown) =>
    ipcRenderer.invoke("native-context-menu:show", items, options),
});
