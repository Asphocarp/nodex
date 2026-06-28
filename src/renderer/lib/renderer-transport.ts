import { browserRendererTransport } from "./browser-renderer-transport";
import { createElectronRendererTransport, type ElectronRendererBridge } from "./electron-renderer-transport";
import type { CommandKeymapState } from "../../shared/command-keybindings";
import type { BoardChangeEvent } from "../../shared/ipc-api";

export interface RendererTransport {
  kind: "browser" | "electron";
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
  subscribeBoardChanges: (projectId: string, callback: (event: BoardChangeEvent) => void) => () => void;
  subscribeProjectSessionChanges: (
    projectId: string | null,
    callback: (event: import("../../shared/ipc-api").ProjectSessionsChangeEvent) => void,
  ) => () => void;
  subscribeProjectChanges: (callback: (event: import("../../shared/ipc-api").ProjectsChangeEvent) => void) => () => void;
  subscribeCodexHostMessages: (callback: (message: import("./types").CodexHostMessage) => void) => () => void;
  subscribeDesktopNotificationActions: (
    callback: (payload: import("./types").DesktopNotificationActionPayload & {
      conversationId: string | null;
      requestId: string | null;
    }) => void,
  ) => () => void;
  subscribeGitBranchChanges: (callback: (event: { cwd: string }) => void) => () => void;
  subscribeAppUpdateStatus: (callback: (status: import("./types").AppUpdateStatus) => void) => () => void;
  subscribeCommandKeymapChanges: (callback: (state: CommandKeymapState) => void) => () => void;
  subscribeCommandPaletteThreadIndexUpdates: (
    callback: (event: import("../../shared/types").CommandPaletteThreadIndexUpdatedEvent) => void,
  ) => () => void;
  getWindowFocusState: () => Promise<boolean>;
  subscribeWindowFocusChanges: (callback: (isFocused: boolean) => void) => () => void;
}

const BROWSER_ONLY_INVOKE_CHANNELS = new Set<string>([
  "asset:resolve-path",
]);

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
