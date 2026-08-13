const CODEX_ENVIRONMENT_PATH_MAX_LENGTH = 8_192;

/**
 * Environment selections are portable, workspace-relative identifiers. They
 * deliberately do not carry a source-machine absolute path across IPC or an
 * execution-host boundary.
 */
export function isCodexWorktreeEnvironmentConfigPath(
  value: unknown,
): value is string {
  if (typeof value !== "string" || value !== value.trim()) return false;
  if (value.length === 0 || value.length > CODEX_ENVIRONMENT_PATH_MAX_LENGTH) {
    return false;
  }
  if (value.includes("\0") || /^[A-Za-z]:[\\/]/u.test(value)) return false;
  if (value.startsWith("/") || value.startsWith("\\")) return false;

  const segments = value.split(/[\\/]/u);
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    return false;
  }
  if (segments[0] !== ".codex" || segments[1] !== "environments") return false;
  if (segments.length < 3) return false;
  return segments.at(-1)?.toLowerCase().endsWith(".toml") === true;
}

export function requireCodexWorktreeEnvironmentConfigPath(
  value: unknown,
): string {
  if (isCodexWorktreeEnvironmentConfigPath(value)) return value;
  throw new Error(
    "Local environment config path must be a workspace-relative .toml file inside .codex/environments",
  );
}
