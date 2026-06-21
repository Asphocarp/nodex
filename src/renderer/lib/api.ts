import { resolveInvokeTransport, resolveRendererTransport } from "./renderer-transport";
import type { IpcApi } from "../../shared/ipc-api";

const BROWSER_CODEX_INVOKE_CHANNELS = new Set<string>([
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
    channel.startsWith("codex:")
    && transport.kind !== "electron"
    && !BROWSER_CODEX_INVOKE_CHANNELS.has(channel)
  ) {
    throw new Error("Codex threads require Electron in this release");
  }

  return transport.invoke(channel, ...args);
}

export function subscribeBoardChanges(
  projectId: string,
  callback: () => void,
): () => void {
  return resolveRendererTransport().subscribeBoardChanges(projectId, callback);
}

export function subscribeProjectSessionChanges(
  projectId: string | null,
  callback: (event: import("../../shared/ipc-api").ProjectSessionsChangeEvent) => void,
): () => void {
  return resolveRendererTransport().subscribeProjectSessionChanges(projectId, callback);
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

export function subscribeDesktopNotificationActions(
  callback: (
    payload: import("./types").DesktopNotificationActionPayload & {
      conversationId: string | null;
      requestId: string | null;
    },
  ) => void,
): () => void {
  return resolveRendererTransport().subscribeDesktopNotificationActions(callback);
}

export function subscribeGitBranchChanges(
  callback: (event: { cwd: string }) => void,
): () => void {
  return resolveRendererTransport().subscribeGitBranchChanges(callback);
}

export function subscribeAppUpdateStatus(
  callback: (status: import("./types").AppUpdateStatus) => void,
): () => void {
  return resolveRendererTransport().subscribeAppUpdateStatus(callback);
}

export function subscribeCommandKeymapChanges(
  callback: (state: import("../../shared/command-keybindings").CommandKeymapState) => void,
): () => void {
  return resolveRendererTransport().subscribeCommandKeymapChanges(callback);
}

export function getWindowFocusState(): Promise<boolean> {
  return resolveRendererTransport().getWindowFocusState();
}

export function subscribeWindowFocusChanges(
  callback: (isFocused: boolean) => void,
): () => void {
  return resolveRendererTransport().subscribeWindowFocusChanges(callback);
}
