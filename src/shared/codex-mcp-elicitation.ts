import type { McpServerElicitationRequestParams } from "@nodex/codex-app-server-protocol/v2/McpServerElicitationRequestParams";

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
}

function parseHttpsUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}

function isChatGptHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === "chatgpt.com"
    || normalized === "chatgpt-staging.com"
    || normalized.endsWith(".chatgpt.com")
    || normalized.endsWith(".chatgpt-staging.com");
}

function hasConnectorAuthFailureMeta(value: unknown): boolean {
  const meta = asRecord(value);
  const codexApps = asRecord(meta?._codex_apps);
  const failure = asRecord(codexApps?.connector_auth_failure);
  return failure?.is_auth_failure === true
    && typeof failure.connector_id === "string"
    && typeof failure.connector_name === "string"
    && typeof failure.install_url === "string"
    && (
      failure.auth_reason === undefined
      || typeof failure.auth_reason === "string"
    )
    && (
      failure.link_id === undefined
      || typeof failure.link_id === "string"
    )
    && (
      failure.requested_scopes === undefined
      || (
        Array.isArray(failure.requested_scopes)
        && failure.requested_scopes.every((scope) => typeof scope === "string" && scope.trim().length > 0)
      )
    );
}

export function isRenderableMcpServerElicitationRequest(
  params: McpServerElicitationRequestParams,
): boolean {
  if (params.mode !== "url") return true;

  const url = parseHttpsUrl(params.url);
  if (!url) return false;

  if (params.serverName !== "codex_apps") return true;

  return isChatGptHost(url.hostname) && hasConnectorAuthFailureMeta(params._meta);
}
