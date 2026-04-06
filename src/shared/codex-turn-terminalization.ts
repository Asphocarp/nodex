import type {
  CodexItemView,
  CodexTranscriptEntry,
  CodexTurnStatus,
} from "./types";

function resolveEntryKind(entry: CodexItemView | CodexTranscriptEntry): string {
  if ("normalizedKind" in entry && typeof entry.normalizedKind === "string") {
    return entry.normalizedKind;
  }

  if ("kind" in entry && typeof entry.kind === "string") {
    return entry.kind;
  }

  return "";
}

function resolveSemanticKind(entry: CodexItemView | CodexTranscriptEntry): string {
  return typeof entry.semanticKind === "string" ? entry.semanticKind : "";
}

export function shouldTerminalizeItemWithTurn(
  entry: CodexItemView | CodexTranscriptEntry,
  turnStatus: CodexTurnStatus,
): boolean {
  if (entry.status !== "inProgress") {
    return false;
  }

  if (turnStatus === "interrupted") {
    return true;
  }

  if (resolveSemanticKind(entry) === "planImplementation") {
    return false;
  }

  return resolveEntryKind(entry) !== "commandExecution";
}
