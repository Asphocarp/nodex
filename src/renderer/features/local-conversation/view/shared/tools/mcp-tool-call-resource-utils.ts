import type {
  CodexMcpToolCallContentBlock,
  CodexMcpToolCallView,
  ProtocolMcpResourceReadResponse,
  ProtocolMcpServerStatus,
} from "../../../../../lib/types";

export type McpAppRenderMode = "fallback" | "html" | "dil";

export interface McpWidgetCsp {
  connectDomains?: string[];
  resourceDomains?: string[];
}

export interface McpWidgetMetadata {
  domain: string | null;
  csp: McpWidgetCsp | null;
  heightHint: number | null;
  prefersBorder: boolean;
}

export interface McpRenderableResource {
  uri: string;
  mode: Exclude<McpAppRenderMode, "fallback">;
  html: string;
  mimeType: string | null;
  metadata: McpWidgetMetadata;
}

const HTML_MIME_TYPES = new Set(["text/html", "text/html;profile=mcp-app"]);
const DIL_MIME_TYPES = new Set(["text/x-dil;profile=mcp-app"]);
const RESOURCE_URI_KEYS = [
  "openai/outputTemplate",
  "ui.resourceUri",
  "ui/resourceUri",
  "resourceUri",
] as const;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null) return null;
  return value as Record<string, unknown>;
}

function getNestedValue(record: Record<string, unknown>, key: string): unknown {
  if (Object.prototype.hasOwnProperty.call(record, key)) return record[key];
  if (!key.includes(".")) return undefined;

  return key.split(".").reduce<unknown>((acc, part) => {
    const nested = asRecord(acc);
    return nested ? nested[part] : undefined;
  }, record);
}

function readStringMeta(meta: unknown, keys: readonly string[]): string | null {
  const record = asRecord(meta);
  if (!record) return null;

  for (const key of keys) {
    const value = getNestedValue(record, key);
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }

  return null;
}

function readNumberMeta(meta: unknown, keys: readonly string[]): number | null {
  const record = asRecord(meta);
  if (!record) return null;

  for (const key of keys) {
    const value = getNestedValue(record, key);
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }

  return null;
}

function readBooleanMeta(meta: unknown, keys: readonly string[]): boolean | null {
  const record = asRecord(meta);
  if (!record) return null;

  for (const key of keys) {
    const value = getNestedValue(record, key);
    if (typeof value === "boolean") return value;
  }

  return null;
}

function normalizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const normalized = value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
  return normalized.length > 0 ? normalized : undefined;
}

function readCspMeta(meta: unknown): McpWidgetCsp | null {
  const record = asRecord(meta);
  if (!record) return null;
  const csp = asRecord(record["openai/widgetCSP"])
    ?? asRecord(record["ui.csp"])
    ?? asRecord(record.ui ? asRecord(record.ui)?.csp : null);
  if (!csp) return null;

  const connectDomains = normalizeStringArray(csp.connect_domains ?? csp.connectDomains);
  const resourceDomains = normalizeStringArray(csp.resource_domains ?? csp.resourceDomains);
  if (!connectDomains && !resourceDomains) return null;

  return { connectDomains, resourceDomains };
}

export function resolveMcpWidgetMetadata(meta: unknown): McpWidgetMetadata {
  return {
    domain: readStringMeta(meta, ["openai/widgetDomain", "ui.domain", "ui/widgetDomain"]),
    csp: readCspMeta(meta),
    heightHint: readNumberMeta(meta, ["openai/widgetHeightHint", "ui.heightHint", "ui/widgetHeightHint"]),
    prefersBorder: readBooleanMeta(meta, ["openai/widgetPrefersBorder", "ui.prefersBorder", "ui/widgetPrefersBorder"]) ?? false,
  };
}

export function resolveMcpResourceUriFromMeta(meta: unknown): string | null {
  return readStringMeta(meta, RESOURCE_URI_KEYS);
}

function resolveToolMetadata(
  payload: CodexMcpToolCallView,
  serverStatuses: readonly ProtocolMcpServerStatus[],
): unknown {
  const status = serverStatuses.find((entry) => entry.name === payload.invocation.server);
  return status?.tools[payload.invocation.tool]?._meta ?? null;
}

export function resolveMcpAppResourceUri(input: {
  payload: CodexMcpToolCallView;
  serverStatuses?: readonly ProtocolMcpServerStatus[];
}): string | null {
  const toolMeta = input.serverStatuses ? resolveToolMetadata(input.payload, input.serverStatuses) : null;
  return resolveMcpResourceUriFromMeta(toolMeta)
    ?? (input.payload.result?.type === "success" ? resolveMcpResourceUriFromMeta(input.payload.result.meta) : null)
    ?? input.payload.mcpAppResourceUri
    ?? null;
}

function normalizeMimeType(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

export function resolveMcpRenderableResource(
  resourceUri: string,
  response: ProtocolMcpResourceReadResponse | null,
): McpRenderableResource | null {
  const content = response?.contents.find((entry) => entry.uri === resourceUri) ?? response?.contents[0] ?? null;
  if (!content) return null;

  const mimeType = normalizeMimeType(content.mimeType);
  const mode = HTML_MIME_TYPES.has(mimeType)
    ? "html"
    : DIL_MIME_TYPES.has(mimeType)
      ? "dil"
      : "fallback";
  if (mode === "fallback") return null;

  const html = "text" in content ? content.text : "blob" in content ? atob(content.blob) : "";
  if (!html.trim()) return null;

  return {
    uri: content.uri,
    mode,
    html,
    mimeType: content.mimeType ?? null,
    metadata: resolveMcpWidgetMetadata(content._meta),
  };
}

export function shouldHideDuplicateMcpTextContent(
  content: CodexMcpToolCallContentBlock,
  resource: McpRenderableResource | null,
): boolean {
  if (!resource || content.type !== "text") return false;
  const text = content.text.trim();
  if (!text) return false;
  return text === resource.html.trim() || text === resource.uri;
}
