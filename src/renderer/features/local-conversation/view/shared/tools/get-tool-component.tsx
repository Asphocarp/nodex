import type { ComponentType } from "react";
import type { CodexTranscriptEntry } from "../../../../../lib/types";
import { CommandToolCall } from "./command-tool-call";
import { FileChangeToolCall } from "./file-change-tool-call";
import { GenericToolCall } from "./generic-tool-call";
import { McpToolCall } from "./mcp-tool-call";
import { TurnDiffToolCall } from "./turn-diff-tool-call";
import { WebSearchToolCall } from "./web-search-tool-call";

export interface ToolComponentProps {
  item: CodexTranscriptEntry;
  projectWorkspacePath?: string;
  threadCwd?: string;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
}

type ToolComponent = ComponentType<ToolComponentProps>;

export function getToolComponent(item: CodexTranscriptEntry): ToolComponent {
  if (item.semanticKind === "exec" || item.kind === "commandExecution" || item.toolCall?.subtype === "command") {
    return CommandToolCall;
  }

  if (
    item.semanticKind === "patch"
    || item.kind === "fileChange"
    || item.toolCall?.subtype === "fileChange"
  ) {
    return FileChangeToolCall;
  }

  if (item.semanticKind === "diff") {
    return TurnDiffToolCall;
  }

  if (item.semanticKind === "webSearch" || item.toolCall?.subtype === "webSearch") {
    return WebSearchToolCall;
  }

  if (item.semanticKind === "mcpToolCall" || item.toolCall?.subtype === "mcp") {
    return McpToolCall;
  }

  return GenericToolCall;
}
