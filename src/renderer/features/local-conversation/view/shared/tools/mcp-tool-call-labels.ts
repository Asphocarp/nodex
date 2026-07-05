import type { CodexMcpToolCallView } from "../../../../../lib/types";
import { asRecord, humanizeIdentifier } from "./tool-call-utils";

const MCP_TOOL_TITLE_MAX_LENGTH = 80;

const MCP_TOOL_NAME_ACRONYMS: Readonly<Record<string, string>> = {
  api: "API",
  cdp: "CDP",
  cli: "CLI",
  css: "CSS",
  html: "HTML",
  http: "HTTP",
  https: "HTTPS",
  id: "ID",
  js: "JS",
  json: "JSON",
  mcp: "MCP",
  pr: "PR",
  sql: "SQL",
  ui: "UI",
  uri: "URI",
  url: "URL",
  xml: "XML",
};

export function formatMcpServerName(server: string): string {
  const humanized = humanizeIdentifier(server);
  return humanized.length > 0 ? humanized : "MCP";
}

function splitMcpIdentifierParts(value: string): string[] {
  return value
    .trim()
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter((part) => part.length > 0);
}

function sentenceCaseMcpToolName(value: string): string {
  const parts = splitMcpIdentifierParts(value);
  if (parts.length === 0) return "MCP tool";

  return parts
    .map((part, index) => {
      const acronym = MCP_TOOL_NAME_ACRONYMS[part];
      if (acronym) return acronym;
      if (index > 0) return part;
      return `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`;
    })
    .join(" ");
}

function resolveMcpJsTitle(argumentsValue: unknown): string | null {
  const argumentsRecord = asRecord(argumentsValue);
  const rawTitle = argumentsRecord?.title;
  if (typeof rawTitle !== "string") return null;

  const title = rawTitle.trim().replace(/\s+/g, " ");
  if (title.length === 0) return null;
  if (title.length <= MCP_TOOL_TITLE_MAX_LENGTH) return title;
  return `${title.slice(0, MCP_TOOL_TITLE_MAX_LENGTH - 1).trimEnd()}…`;
}

export function resolveMcpToolDisplayName(payload: CodexMcpToolCallView): string {
  const toolKey = splitMcpIdentifierParts(payload.invocation.tool).join("_");
  if (toolKey === "js") {
    const title = resolveMcpJsTitle(payload.invocation.arguments);
    if (title) return title;
  }

  return sentenceCaseMcpToolName(payload.invocation.tool);
}
