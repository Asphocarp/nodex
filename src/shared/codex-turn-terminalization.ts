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

  return resolveEntryKind(entry) !== "commandExecution";
}
