import type {
  CodexMcpToolCallContentBlock,
  CodexMcpToolCallView,
  ProtocolListMcpServerStatusResponse,
  ProtocolMcpResourceReadResponse,
} from "../../../../lib/types";
import {
  resolveCodexMcpAppResourceMetadata,
  resolveCodexMcpResourceUriFromMetadata,
} from "../../../../../shared/codex-mcp-tool-call";
import type { ThreadMcpAppSidePanelInput } from "../../thread-stage-types";
import { formatMcpServerName } from "./mcp-tool-call-labels";

export interface McpWidgetCsp {
  connectDomains?: string[];
  resourceDomains?: string[];
}

export interface McpWidgetMetadata {
  domain: string | null;
  csp: McpWidgetCsp | null;
  heightHint: number | null;
  minFrameHeight: number | null;
  prefersBorder: boolean;
  isCollapsible: boolean;
}

export interface McpRenderableResource {
  uri: string;
  mode: "html";
  html: string;
  mimeType: string | null;
  metadata: McpWidgetMetadata;
}

export function buildMcpAppSidePanelInput(input: {
  threadId: string;
  payload: CodexMcpToolCallView;
  resource: McpRenderableResource;
}): ThreadMcpAppSidePanelInput {
  const server = input.payload.invocation.server;
  const tool = input.payload.invocation.tool;
  const title = `${formatMcpServerName(tool)} - ${formatMcpServerName(server)}`;

  return {
    mcpAppId: `${server}:${input.resource.uri}`,
    capabilityId: `mcp-capability:${input.threadId}:${server}:${tool}:${input.payload.callId}`,
    title,
    threadId: input.threadId,
    server,
    tool,
    resource: input.resource,
  };
}

export const MCP_APP_HTML_MAX_BYTES = 10_000_000;
const HTML_MIME_TYPES = new Set(["text/html", "text/html;profile=mcp-app"]);
const DIL_MIME_TYPES = new Set(["text/x-dil;profile=mcp-app"]);

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
    minFrameHeight: readNumberMeta(meta, ["openai/widgetMinFrameHeight", "ui.minFrameHeight", "ui/widgetMinFrameHeight"]),
    prefersBorder: readBooleanMeta(meta, ["openai/widgetPrefersBorder", "ui.prefersBorder", "ui/widgetPrefersBorder"]) ?? false,
    isCollapsible: !(readBooleanMeta(meta, ["openai/widgetShowCodexWidgetInline", "ui.showCodexWidgetInline", "ui/widgetShowCodexWidgetInline"]) ?? false),
  };
}

export function resolveMcpResourceUriFromMeta(meta: unknown): string | null {
  return resolveCodexMcpResourceUriFromMetadata(meta);
}

export function resolveMcpAppResourceScopeUri(input: {
  payload: CodexMcpToolCallView;
  mcpServerStatuses?: ProtocolListMcpServerStatusResponse | null;
}): string | null {
  const metadataResourceUri = resolveCodexMcpAppResourceMetadata({
    payload: input.payload,
    mcpServerStatuses: input.mcpServerStatuses ?? null,
  })?.resourceUri ?? null;
  if (metadataResourceUri !== null) return metadataResourceUri;
  if (input.payload.result?.type !== "success") return null;
  return input.payload.mcpAppResourceUri ?? null;
}

export function resolveMcpAppResourceUri(input: {
  payload: CodexMcpToolCallView;
  mcpServerStatuses?: ProtocolListMcpServerStatusResponse | null;
}): string | null {
  return resolveMcpAppResourceScopeUri(input)
    ?? input.payload.mcpAppResourceUri
    ?? null;
}

function normalizeMimeType(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function decodeResourceContent(content: ProtocolMcpResourceReadResponse["contents"][number]): string {
  if ("text" in content) return content.text;
  if (!("blob" in content)) return "";

  try {
    return atob(content.blob);
  } catch {
    return "";
  }
}

export function resolveMcpRenderableResource(
  resourceUri: string,
  response: ProtocolMcpResourceReadResponse | null,
): McpRenderableResource | null {
  const contents = response?.contents ?? [];
  const orderedContents = [
    ...contents.filter((entry) => entry.uri === resourceUri),
    ...contents.filter((entry) => entry.uri !== resourceUri),
  ];

  for (const content of orderedContents) {
    const mimeType = normalizeMimeType(content.mimeType);
    const html = decodeResourceContent(content);
    if (!html.trim()) continue;

    if (HTML_MIME_TYPES.has(mimeType)) {
      const htmlResource = {
        uri: content.uri,
        mode: "html" as const,
        html,
        mimeType: content.mimeType ?? null,
        metadata: resolveMcpWidgetMetadata(content._meta),
      };
      return htmlResource;
    }

    if (!DIL_MIME_TYPES.has(mimeType)) continue;
  }

  return null;
}

function getEmbeddedResourceContents(
  payload: CodexMcpToolCallView,
): ProtocolMcpResourceReadResponse["contents"] {
  if (payload.result?.type !== "success") return [];

  type ResourceContent = ProtocolMcpResourceReadResponse["contents"][number];

  return payload.result.raw.content.flatMap<ResourceContent>((rawContent) => {
    const content = asRecord(rawContent);
    if (content?.type !== "embedded_resource" && content?.type !== "resource") return [];
    const resource = asRecord(content.resource);
    if (!resource || typeof resource.uri !== "string") return [];

    if (typeof resource.text === "string") {
      const resourceContent: ResourceContent = {
        uri: resource.uri,
        mimeType: typeof resource.mimeType === "string" ? resource.mimeType : undefined,
        text: resource.text,
        _meta: resource._meta as ResourceContent["_meta"],
      };
      return [resourceContent];
    }

    if (typeof resource.blob === "string") {
      const resourceContent: ResourceContent = {
        uri: resource.uri,
        mimeType: typeof resource.mimeType === "string" ? resource.mimeType : undefined,
        blob: resource.blob,
        _meta: resource._meta as ResourceContent["_meta"],
      };
      return [resourceContent];
    }

    return [];
  });
}

export function resolveMcpEmbeddedRenderableResource(input: {
  payload: CodexMcpToolCallView;
  mcpServerStatuses?: ProtocolListMcpServerStatusResponse | null;
}): McpRenderableResource | null {
  const contents = getEmbeddedResourceContents(input.payload);
  if (contents.length === 0) return null;

  const resourceUri = resolveMcpAppResourceUri(input) ?? contents[0]?.uri;
  if (!resourceUri) return null;

  return resolveMcpRenderableResource(resourceUri, { contents });
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

export function stringifyMcpValue(value: unknown, spacing = 2): string {
  try {
    return JSON.stringify(
      value,
      (_key, nestedValue) => (typeof nestedValue === "bigint" ? nestedValue.toString() : nestedValue),
      spacing,
    ) ?? "null";
  } catch {
    return "";
  }
}

function parseSingleJsonTextContent(content: readonly CodexMcpToolCallContentBlock[]): string | null {
  if (content.length !== 1) return null;
  const [block] = content;
  if (!block || block.type !== "text" || block.annotations != null) return null;

  const trimmed = block.text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;

  try {
    return stringifyMcpValue(JSON.parse(trimmed), 2);
  } catch {
    return null;
  }
}

export function resolveMcpExpandedSuccessDisplay(input: {
  content: readonly CodexMcpToolCallContentBlock[];
  structuredContentJson: string | null;
  isExpanded: boolean;
}): {
  displayContent: readonly CodexMcpToolCallContentBlock[];
  displayStructuredContentJson: string | null;
} {
  if (!input.isExpanded) {
    return {
      displayContent: input.content,
      displayStructuredContentJson: input.structuredContentJson,
    };
  }

  const parsedContentJson = parseSingleJsonTextContent(input.content);
  if (parsedContentJson === null) {
    return {
      displayContent: input.content,
      displayStructuredContentJson: input.structuredContentJson,
    };
  }

  if (input.structuredContentJson === null || parsedContentJson === input.structuredContentJson) {
    return {
      displayContent: [],
      displayStructuredContentJson: input.structuredContentJson ?? parsedContentJson,
    };
  }

  return {
    displayContent: input.content,
    displayStructuredContentJson: input.structuredContentJson,
  };
}

export function shouldShowMcpStructuredContent(input: {
  structuredContentJson: string | null;
  hasMcpAppBranch: boolean;
  hasResourceScope: boolean;
}): boolean {
  return Boolean(input.structuredContentJson) && !(input.hasMcpAppBranch && input.hasResourceScope);
}

export function getMcpAppHtmlByteSize(html: string): number {
  if (typeof Blob === "function") {
    return new Blob([html]).size;
  }

  if (typeof TextEncoder === "function") {
    return new TextEncoder().encode(html).byteLength;
  }

  return html.length;
}

export function isMcpAppHtmlTooLarge(resource: McpRenderableResource): boolean {
  return getMcpAppHtmlByteSize(resource.html) > MCP_APP_HTML_MAX_BYTES;
}

export function resolveMcpAppFrameHeight(metadata?: McpWidgetMetadata | null): number {
  const preferredHeight = metadata?.heightHint ?? 240;
  const minHeight = metadata?.minFrameHeight ?? 200;
  return Math.min(Math.max(preferredHeight, minHeight), 720);
}
