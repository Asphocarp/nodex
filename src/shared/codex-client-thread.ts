export const CODEX_CLIENT_THREAD_ID_PREFIX = "client-new-thread:";

export function isCodexClientThreadId(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(CODEX_CLIENT_THREAD_ID_PREFIX);
}
