import {
  applyCodexTranscriptDelta,
  dedupeCodexTranscriptEntries,
  upsertCodexTranscriptEntry,
} from "../../shared/codex-thread-detail-reducer";
import { shouldTerminalizeItemWithTurn } from "../../shared/codex-turn-terminalization";
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
    mcpToolCall: item.mcpToolCall,
    dynamicToolCall: item.dynamicToolCall,
    command: item.command,
    cwd: item.cwd,
    processId: item.processId,
    commandActions: item.commandActions,
    aggregatedOutput: item.aggregatedOutput,
    exitCode: item.exitCode,
    durationMs: item.durationMs,
    approvalRequestId: item.approvalRequestId,
    networkApprovalContext: item.networkApprovalContext,
    proposedExecpolicyAmendment: item.proposedExecpolicyAmendment,
    grantRoot: item.grantRoot,
    fileChange: item.fileChange,
    markdownText: item.markdownText,
    userAttachments: item.userAttachments,
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
  userAttachments?: CodexTranscriptEntry["userAttachments"];
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
      userAttachments: input.userAttachments,
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
    entry.turnId === turnId && shouldTerminalizeItemWithTurn(entry, turnStatus)
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
  for (const entry of transcript) {
    const candidate = entry.markdownText?.trim();
    if (!candidate || !isUserTranscriptEntry(entry)) continue;
    return candidate;
  }

  const fallbackPreview = fallback.trim();
  if (fallbackPreview) return fallbackPreview;

  for (const entry of transcript) {
    const candidate = entry.markdownText?.trim();
    if (!candidate) continue;
    return candidate;
  }

  return "";
}

function isUserTranscriptEntry(entry: CodexTranscriptEntry): boolean {
  return entry.role === "user" || entry.kind === "userMessage" || entry.semanticKind === "userMessage";
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
