import type { ComponentType } from "react";
import type { CodexTranscriptEntry } from "../../../../../lib/types";
import { CommandToolCall } from "./command-tool-call";
import { FileChangeToolCall } from "./file-change-tool-call";
import { McpToolCall } from "./mcp-tool-call";
import { WebSearchToolCall } from "./web-search-tool-call";

export interface ToolComponentProps {
  item: CodexTranscriptEntry;
  projectWorkspacePath?: string;
  threadCwd?: string;
}

type ToolComponent = ComponentType<ToolComponentProps>;

export function getToolComponent(item: CodexTranscriptEntry): ToolComponent | null {
  if (item.semanticKind === "exec" || item.kind === "commandExecution") {
    return CommandToolCall;
  }

  if (item.kind === "fileChange") {
    return FileChangeToolCall;
  }

  if (item.semanticKind === "webSearch" || item.toolCall?.subtype === "webSearch") {
    return WebSearchToolCall;
  }

  if (item.semanticKind === "mcpToolCall" || item.toolCall?.subtype === "mcp") {
    return McpToolCall;
  }

  return null;
}
