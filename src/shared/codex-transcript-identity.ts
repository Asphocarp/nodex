import type { CodexTranscriptEntry } from "./types";

function normalizeTranscriptText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

type CodexTranscriptPrimaryIdentityInput = Pick<
  CodexTranscriptEntry,
  "turnId" | "entryId" | "itemId"
>;

type CodexTranscriptTextIdentityInput = Pick<
  CodexTranscriptEntry,
  "turnId" | "entryId" | "itemId" | "kind" | "markdownText"
>;

function isTextIdentityKind(kind: string | undefined): boolean {
  return (
    kind === "userMessage" ||
    kind === "assistantMessage" ||
    kind === "plan" ||
    kind === "reasoning"
  );
}

export function resolveCodexTranscriptPrimaryIdentityKey(
  entry: CodexTranscriptPrimaryIdentityInput,
): string {
  return `${entry.turnId}:id:${entry.itemId || entry.entryId || ""}`;
}

export function isSyntheticCodexTranscriptEntryId(entryId: string): boolean {
  return /^item-\d+$/.test(entryId) || entryId.startsWith("replay:");
}

export function resolveCodexTranscriptTextIdentityKey(
  entry: CodexTranscriptTextIdentityInput,
): string | null {
  if (!isTextIdentityKind(entry.kind)) return null;

  const normalizedText = normalizeTranscriptText(entry.markdownText ?? "");
  if (!normalizedText) return null;

  return `${entry.turnId}:text:${entry.kind}:${normalizedText}`;
}

export function canMergeSyntheticTranscriptDuplicate(
  existing: CodexTranscriptTextIdentityInput,
  incoming: CodexTranscriptTextIdentityInput,
): boolean {
  const samePrimary =
    resolveCodexTranscriptPrimaryIdentityKey(existing) === resolveCodexTranscriptPrimaryIdentityKey(incoming);
  if (samePrimary) return true;

  const oneSynthetic =
    isSyntheticCodexTranscriptEntryId(existing.entryId ?? existing.itemId) !==
    isSyntheticCodexTranscriptEntryId(incoming.entryId ?? incoming.itemId);
  if (!oneSynthetic) return false;

  const existingTextKey = resolveCodexTranscriptTextIdentityKey(existing);
  const incomingTextKey = resolveCodexTranscriptTextIdentityKey(incoming);
  if (!existingTextKey || !incomingTextKey) return false;
  return existingTextKey === incomingTextKey;
}

export function mergeCodexTranscriptEntry(
  existing: CodexTranscriptEntry,
  incoming: CodexTranscriptEntry,
): CodexTranscriptEntry {
  return {
    ...existing,
    ...incoming,
    itemId: incoming.itemId || existing.itemId,
    entryId: incoming.entryId ?? incoming.itemId ?? existing.entryId ?? existing.itemId,
    kind: incoming.kind,
    semanticKind: incoming.semanticKind ?? existing.semanticKind,
    role: incoming.role ?? existing.role,
    toolCall: incoming.toolCall ?? existing.toolCall,
    markdownText: incoming.markdownText ?? existing.markdownText,
    userInputQuestions: incoming.userInputQuestions ?? existing.userInputQuestions,
    userInputAnswers: incoming.userInputAnswers ?? existing.userInputAnswers,
    rawItem: incoming.rawItem ?? existing.rawItem,
    status: incoming.status ?? existing.status,
    source: incoming.source ?? existing.source,
    sequence: Math.min(existing.sequence ?? 0, incoming.sequence ?? 0),
    createdAt: Math.min(existing.createdAt, incoming.createdAt),
    updatedAt: Math.max(existing.updatedAt, incoming.updatedAt),
  };
}
