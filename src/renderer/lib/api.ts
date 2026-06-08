import { resolveInvokeTransport, resolveRendererTransport } from "./renderer-transport";

export async function invoke(
  channel: string,
  ...args: unknown[]
): Promise<unknown> {
  const transport = resolveInvokeTransport(channel);

  if (channel.startsWith("codex:") && transport.kind !== "electron") {
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
  projectId: string,
  callback: () => void,
): () => void {
  return resolveRendererTransport().subscribeProjectSessionChanges(projectId, callback);
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

export function getWindowFocusState(): Promise<boolean> {
  return resolveRendererTransport().getWindowFocusState();
}

export function subscribeWindowFocusChanges(
  callback: (isFocused: boolean) => void,
): () => void {
  return resolveRendererTransport().subscribeWindowFocusChanges(callback);
}
