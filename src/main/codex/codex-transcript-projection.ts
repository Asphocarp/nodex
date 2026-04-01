import {
  applyCodexTranscriptDelta,
  dedupeCodexTranscriptEntries,
  upsertCodexTranscriptEntry,
} from "../../shared/codex-thread-detail-reducer";
import type {
  CodexItemView,
  CodexTranscriptEntry,
  CodexTranscriptEntrySource,
  CodexTurnStatus,
} from "../../shared/types";

export interface CodexTranscriptProjectionMutation {
  type: "upsert" | "delta";
  entry?: CodexTranscriptEntry;
  threadId?: string;
  turnId?: string;
  entryId?: string;
  delta?: string;
}

function projectItemToTranscriptEntry(
  item: CodexItemView,
  source: CodexTranscriptEntrySource,
  sequence: number,
): CodexTranscriptEntry {
  return {
    threadId: item.threadId,
    turnId: item.turnId,
    entryId: item.itemId,
    itemId: item.itemId,
    type: item.type,
    kind: item.normalizedKind,
    semanticKind: item.semanticKind,
    assistantPhase: item.assistantPhase,
    timeLabel: item.timeLabel,
    status: item.status,
    role: item.role,
    source,
    sequence,
    toolCall: item.toolCall,
    fileChange: item.fileChange,
    markdownText: item.markdownText,
    additionalDetails: item.additionalDetails,
    willRetry: item.willRetry,
    userInputQuestions: item.userInputQuestions,
    userInputAnswers: item.userInputAnswers,
    rawItem: item.rawItem,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

export function buildTranscriptFromBootstrapEvents(input: {
  items?: CodexItemView[];
  transcript?: CodexTranscriptEntry[];
  source: CodexTranscriptEntrySource;
}): CodexTranscriptEntry[] {
  const seededEntries = input.transcript
    ? input.transcript.map((entry, index) => ({
        ...entry,
        source: entry.source ?? input.source,
        sequence: Number.isFinite(entry.sequence) ? entry.sequence : index,
      }))
    : (input.items ?? []).map((item, index) => projectItemToTranscriptEntry(item, input.source, index));

  return dedupeCodexTranscriptEntries(seededEntries);
}

export function applyLiveTranscriptMutation(
  transcript: CodexTranscriptEntry[],
  mutation: CodexTranscriptProjectionMutation,
): CodexTranscriptEntry[] {
  if (mutation.type === "delta") {
    if (!mutation.threadId || !mutation.turnId || !mutation.entryId || typeof mutation.delta !== "string") {
      return transcript;
    }

    return applyCodexTranscriptDelta(transcript, {
      threadId: mutation.threadId,
      turnId: mutation.turnId,
      entryId: mutation.entryId,
      delta: mutation.delta,
    });
  }

  if (!mutation.entry) return transcript;
  return upsertCodexTranscriptEntry(transcript, mutation.entry);
}

export function applyOptimisticUserPrompt(input: {
  transcript: CodexTranscriptEntry[];
  threadId: string;
  turnId: string;
  entryId: string;
  promptText: string;
  createdAt?: number;
}): CodexTranscriptEntry[] {
  const createdAt = input.createdAt ?? Date.now();
  return dedupeCodexTranscriptEntries([
    ...input.transcript,
    {
      threadId: input.threadId,
      turnId: input.turnId,
      entryId: input.entryId,
      itemId: input.entryId,
      type: "userMessage",
      kind: "userMessage",
      semanticKind: "userMessage",
      status: "completed",
      role: "user",
      source: "optimistic",
      sequence: input.transcript.length,
      markdownText: input.promptText,
      createdAt,
      updatedAt: createdAt,
    },
  ]);
}

export function reconcileCommittedUserPrompt(
  transcript: CodexTranscriptEntry[],
  entry: CodexTranscriptEntry,
): CodexTranscriptEntry[] {
  return upsertCodexTranscriptEntry(transcript, entry);
}

export function finalizeTurnTranscriptState(
  transcript: CodexTranscriptEntry[],
  turnId: string,
  turnStatus: CodexTurnStatus,
): CodexTranscriptEntry[] {
  if (turnStatus === "inProgress") return transcript;

  const nextEntries = transcript.map((entry) =>
    entry.turnId === turnId && entry.status === "inProgress"
      ? {
          ...entry,
          status: turnStatus,
          updatedAt: Math.max(entry.updatedAt, Date.now()),
        }
      : entry,
  );

  return dedupeCodexTranscriptEntries(nextEntries);
}

export function resolveThreadPreviewFromTranscript(
  transcript: CodexTranscriptEntry[],
  fallback: string,
): string {
  for (let index = transcript.length - 1; index >= 0; index -= 1) {
    const candidate = transcript[index]?.markdownText?.trim();
    if (!candidate) continue;
    return candidate;
  }

  return fallback;
}

export function projectItemToLiveTranscriptEntry(
  item: CodexItemView,
  source: CodexTranscriptEntrySource,
  existingTranscript: CodexTranscriptEntry[],
  canonicalTurnItemIds?: readonly string[],
): CodexTranscriptEntry {
  const existingEntry = existingTranscript.find((entry) =>
    entry.threadId === item.threadId
    && entry.turnId === item.turnId
    && (entry.entryId ?? entry.itemId) === item.itemId,
  );

  const canonicalSequence = canonicalTurnItemIds?.indexOf(item.itemId) ?? -1;

  return projectItemToTranscriptEntry(
    item,
    source,
    existingEntry?.sequence ?? (canonicalSequence >= 0 ? canonicalSequence : existingTranscript.length),
  );
}
