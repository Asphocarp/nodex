import { contextBridge, ipcRenderer, webUtils } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import type { AppInitializationStep } from "../shared/app-startup";
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
import { inspectClipboardPasteItems, readClipboardPastePayload } from "../main/clipboard-paste-inspector";
import type { CodexDesktopMessageFromView } from "../shared/remote-hosted-pip";
import { parseAssetSource } from "../shared/assets";

const ASSET_PATH_PREFIX_ARG_PREFIX = "--nodex-asset-path-prefix=";

function getAssetPathPrefixFromArgv(argv: string[]): string | undefined {
  const arg = argv.find((entry) => entry.startsWith(ASSET_PATH_PREFIX_ARG_PREFIX));
  if (!arg) return undefined;

  const raw = arg.slice(ASSET_PATH_PREFIX_ARG_PREFIX.length).trim();
  if (raw.length === 0) return undefined;

  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

const assetPathPrefix = getAssetPathPrefixFromArgv(process.argv);

function resolveManagedAssetPath(source: string): string | null {
  if (!assetPathPrefix) return null;
  const parsed = parseAssetSource(source);
  if (!parsed) return null;
  return path.join(assetPathPrefix, parsed.fileName);
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
  inspectPasteClipboard: () => inspectClipboardPasteItems(),
  readPasteClipboard: () => readClipboardPastePayload(),
  getPathInfoForFile: (file: File) => {
    try {
      const absolutePath = webUtils.getPathForFile(file);
      if (!absolutePath) return null;

      const stats = fs.statSync(absolutePath);
      const kind = stats.isDirectory() ? "folder" : "file";
      return {
        path: absolutePath,
        kind,
        name: path.basename(absolutePath),
        ...(kind === "file" ? { bytes: stats.size } : {}),
      };
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
});

contextBridge.exposeInMainWorld("electronBridge", {
  sendMessageFromView: (message: CodexDesktopMessageFromView) =>
    ipcRenderer.invoke("codex-desktop:message-from-view", message).then(() => undefined),
  showContextMenu: (items: unknown[], options?: unknown) =>
    ipcRenderer.invoke("native-context-menu:show", items, options),
});
