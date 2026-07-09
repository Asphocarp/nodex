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
    mcpToolCall: incoming.mcpToolCall ?? existing.mcpToolCall,
    dynamicToolCall: incoming.dynamicToolCall ?? existing.dynamicToolCall,
    automationUpdate: incoming.automationUpdate ?? existing.automationUpdate,
    webSearch: incoming.webSearch ?? existing.webSearch,
    requestId: incoming.requestId ?? existing.requestId,
    markdownText: incoming.markdownText ?? existing.markdownText,
    goal: incoming.goal ?? existing.goal,
    userAttachments: incoming.userAttachments ?? existing.userAttachments,
    callId: incoming.callId ?? existing.callId,
    commandExecutionItemId:
      incoming.commandExecutionItemId ?? existing.commandExecutionItemId,
    command: incoming.command !== undefined ? incoming.command : existing.command,
    cmd: incoming.cmd ?? existing.cmd,
    cwd: incoming.cwd !== undefined ? incoming.cwd : existing.cwd,
    processId: incoming.processId !== undefined ? incoming.processId : existing.processId,
    commandActions: incoming.commandActions !== undefined ? incoming.commandActions : existing.commandActions,
    aggregatedOutput: incoming.aggregatedOutput !== undefined ? incoming.aggregatedOutput : existing.aggregatedOutput,
    exitCode: incoming.exitCode !== undefined ? incoming.exitCode : existing.exitCode,
    durationMs: incoming.durationMs !== undefined ? incoming.durationMs : existing.durationMs,
    startedAtMs: incoming.startedAtMs ?? existing.startedAtMs,
    executionStatus: incoming.executionStatus ?? existing.executionStatus,
    parsedCmd: incoming.parsedCmd ?? existing.parsedCmd,
    approvalRequestId:
      incoming.approvalRequestId !== undefined ? incoming.approvalRequestId : existing.approvalRequestId,
    approvalReason:
      incoming.approvalReason !== undefined ? incoming.approvalReason : existing.approvalReason,
    networkApprovalContext:
      incoming.networkApprovalContext !== undefined
        ? incoming.networkApprovalContext
        : existing.networkApprovalContext,
    proposedExecpolicyAmendment:
      incoming.proposedExecpolicyAmendment !== undefined
        ? incoming.proposedExecpolicyAmendment
        : existing.proposedExecpolicyAmendment,
    proposedNetworkPolicyAmendments:
      incoming.proposedNetworkPolicyAmendments !== undefined
        ? incoming.proposedNetworkPolicyAmendments
        : existing.proposedNetworkPolicyAmendments,
    grantRoot: incoming.grantRoot !== undefined ? incoming.grantRoot : existing.grantRoot,
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
