import type { CodexItemView } from "./types";

function normalizeUserMessageText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

type CodexItemPrimaryIdentityInput = Pick<CodexItemView, "turnId" | "itemId">;

type CodexItemTextIdentityInput = Pick<
  CodexItemView,
  "turnId" | "itemId" | "normalizedKind" | "markdownText"
>;

function isTextIdentityKind(kind: string | undefined): boolean {
  return (
    kind === "userMessage" || kind === "assistantMessage" || kind === "plan" || kind === "reasoning"
  );
}

export function resolveCodexItemPrimaryIdentityKey(item: CodexItemPrimaryIdentityInput): string {
  return `${item.turnId}:id:${item.itemId}`;
}

export function isSyntheticCodexItemId(itemId: string): boolean {
  return /^item-\d+$/.test(itemId) || itemId.startsWith("replay:");
}

export function resolveCodexItemTextIdentityKey(item: CodexItemTextIdentityInput): string | null {
  const normalizedKind = item.normalizedKind;
  if (!isTextIdentityKind(normalizedKind)) {
    return null;
  }

  const normalizedText = normalizeUserMessageText(item.markdownText ?? "");
  if (!normalizedText) {
    return null;
  }

  return `${item.turnId}:text:${normalizedKind}:${normalizedText}`;
}

export function canMergeSyntheticTextDuplicate(
  existing: CodexItemTextIdentityInput,
  incoming: CodexItemTextIdentityInput,
): boolean {
  const samePrimary =
    resolveCodexItemPrimaryIdentityKey(existing) === resolveCodexItemPrimaryIdentityKey(incoming);
  if (samePrimary) return true;

  const oneSynthetic =
    isSyntheticCodexItemId(existing.itemId) !== isSyntheticCodexItemId(incoming.itemId);
  if (!oneSynthetic) return false;

  const existingTextKey = resolveCodexItemTextIdentityKey(existing);
  const incomingTextKey = resolveCodexItemTextIdentityKey(incoming);
  if (!existingTextKey || !incomingTextKey) return false;
  return existingTextKey === incomingTextKey;
}

export function mergeCodexItemView(
  existing: CodexItemView,
  incoming: CodexItemView,
): CodexItemView {
  return {
    ...existing,
    ...incoming,
    normalizedKind: incoming.normalizedKind,
    semanticKind: incoming.semanticKind ?? existing.semanticKind,
    role: incoming.role ?? existing.role,
    toolCall: incoming.toolCall ?? existing.toolCall,
    mcpToolCall: incoming.mcpToolCall ?? existing.mcpToolCall,
    dynamicToolCall: incoming.dynamicToolCall ?? existing.dynamicToolCall,
    markdownText: incoming.markdownText ?? existing.markdownText,
    goal: incoming.goal ?? existing.goal,
    userAttachments: incoming.userAttachments ?? existing.userAttachments,
    command: incoming.command !== undefined ? incoming.command : existing.command,
    cwd: incoming.cwd !== undefined ? incoming.cwd : existing.cwd,
    processId: incoming.processId !== undefined ? incoming.processId : existing.processId,
    commandActions:
      incoming.commandActions !== undefined ? incoming.commandActions : existing.commandActions,
    aggregatedOutput:
      incoming.aggregatedOutput !== undefined
        ? incoming.aggregatedOutput
        : existing.aggregatedOutput,
    exitCode: incoming.exitCode !== undefined ? incoming.exitCode : existing.exitCode,
    durationMs: incoming.durationMs !== undefined ? incoming.durationMs : existing.durationMs,
    approvalRequestId:
      incoming.approvalRequestId !== undefined
        ? incoming.approvalRequestId
        : existing.approvalRequestId,
    networkApprovalContext:
      incoming.networkApprovalContext !== undefined
        ? incoming.networkApprovalContext
        : existing.networkApprovalContext,
    proposedExecpolicyAmendment:
      incoming.proposedExecpolicyAmendment !== undefined
        ? incoming.proposedExecpolicyAmendment
        : existing.proposedExecpolicyAmendment,
    grantRoot: incoming.grantRoot !== undefined ? incoming.grantRoot : existing.grantRoot,
    userInputQuestions: incoming.userInputQuestions ?? existing.userInputQuestions,
    userInputAnswers: incoming.userInputAnswers ?? existing.userInputAnswers,
    rawItem: incoming.rawItem ?? existing.rawItem,
    status: incoming.status ?? existing.status,
    createdAt: Math.min(existing.createdAt, incoming.createdAt),
    updatedAt: Math.max(existing.updatedAt, incoming.updatedAt),
  };
}
