import type {
  CodexConversationChildMembership,
  CodexConversationItem,
  CodexConversationSnapshot,
  CodexConversationTurn,
  CodexThreadStatusType,
} from "../../../lib/types";
import type {
  CodexMultiAgentActionName,
  CodexMultiAgentAgentState,
  CodexMultiAgentAgentStatus,
  CodexMultiAgentReceiverThread,
} from "../../../../shared/codex-transcript-special-items";
import { normalizeMultiAgentActionPayload } from "../../../../shared/codex-transcript-special-items";
import type { ThreadComposerShellBackgroundAgentRowModel } from "../thread-stage-types";

type BackgroundSubagentNormalizedStatus = "active" | "waiting" | "done" | "hidden" | "unknown";
type ChildProgressStatus = "inProgress" | "notInProgress" | "unknown";

interface BackgroundSubagentLatestReference {
  tool: CodexMultiAgentActionName;
  parentTurnKey: string;
  thread: CodexMultiAgentReceiverThread["thread"];
  agentState: CodexMultiAgentAgentState | null;
  spawnModel: string | null;
  usesThreadStatus: boolean;
}

export interface BuildBackgroundSubagentRowsInput {
  childMemberships: readonly CodexConversationChildMembership[];
  parentTurns: readonly CodexConversationTurn[];
  knownConversationsById: Record<string, CodexConversationSnapshot>;
}

type BackgroundSubagentThreadMetadata =
  | CodexMultiAgentReceiverThread["thread"]
  | CodexConversationChildMembership["thread"];

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
}

function normalizeOptionalText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function stripLeadingAt(value: string): string {
  const trimmed = value.trim();
  return trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
}

function resolveThreadDisplayName(thread: BackgroundSubagentThreadMetadata | null | undefined): string | null {
  return normalizeOptionalText(thread?.nickname);
}

function getParentTurnKey(turn: CodexConversationTurn | null | undefined, index: number): string {
  return turn?.turnId ?? `${index + 1}`;
}

function getLatestParentTurnKey(parentTurns: readonly CodexConversationTurn[]): string {
  if (parentTurns.length === 0) return "0";
  return getParentTurnKey(parentTurns[parentTurns.length - 1], parentTurns.length - 1);
}

function getParentTurnKeyForCreatedAt(
  parentTurns: readonly CodexConversationTurn[],
  createdAtMs: number | null,
): string {
  if (createdAtMs === null || !Number.isFinite(createdAtMs)) {
    return getLatestParentTurnKey(parentTurns);
  }

  for (let index = parentTurns.length - 1; index >= 0; index -= 1) {
    const turn = parentTurns[index];
    const turnStartedAtMs = turn?.turnStartedAtMs;
    if (turn && typeof turnStartedAtMs === "number" && turnStartedAtMs <= createdAtMs) {
      return getParentTurnKey(turn, index);
    }
  }

  return "0";
}

function getInProgressParentTurnKeys(parentTurns: readonly CodexConversationTurn[]): Set<string> {
  const keys = new Set<string>();
  parentTurns.forEach((turn, index) => {
    if (turn.status === "inProgress") {
      keys.add(getParentTurnKey(turn, index));
    }
  });
  return keys;
}

function normalizeAgentStatus(status: CodexMultiAgentAgentStatus | null | undefined): BackgroundSubagentNormalizedStatus {
  switch (status) {
    case "pendingInit":
      return "waiting";
    case "running":
      return "active";
    case "completed":
      return "done";
    case "interrupted":
    case "errored":
    case "shutdown":
    case "notFound":
      return "hidden";
    case null:
    case undefined:
      return "unknown";
  }
}

function mapThreadStatusToAgentStatus(statusType: CodexThreadStatusType): CodexMultiAgentAgentStatus {
  switch (statusType) {
    case "active":
      return "running";
    case "idle":
      return "completed";
    case "notLoaded":
      return "pendingInit";
    case "systemError":
      return "errored";
  }
}

function resolveChildProgress(childConversation: CodexConversationSnapshot | null | undefined): ChildProgressStatus {
  if (
    childConversation?.resumeState === "needs_resume" &&
    childConversation.threadRuntimeStatus?.type === "active"
  ) {
    return "inProgress";
  }

  if (!childConversation || childConversation.turns.length === 0) {
    return "unknown";
  }

  return childConversation.turns[childConversation.turns.length - 1]?.status === "inProgress"
    ? "inProgress"
    : "notInProgress";
}

function resolveVisibleStatus(input: {
  latestReference: BackgroundSubagentLatestReference;
  childProgress: ChildProgressStatus;
  currentParentTurnKey: string;
  inProgressParentTurnKeys: Set<string>;
}): ThreadComposerShellBackgroundAgentRowModel["status"] | null {
  const normalizedStatus = normalizeAgentStatus(input.latestReference.agentState?.status);
  if (input.latestReference.tool === "closeAgent" || normalizedStatus === "hidden") {
    return null;
  }

  const isCurrentParentTurn = input.latestReference.parentTurnKey === input.currentParentTurnKey;
  const isParentTurnInProgress = input.inProgressParentTurnKeys.has(input.latestReference.parentTurnKey);
  const isActive = input.childProgress === "inProgress"
    || (input.latestReference.usesThreadStatus && normalizedStatus === "active")
    || (!input.latestReference.usesThreadStatus && normalizedStatus === "active" && isParentTurnInProgress)
    || (normalizedStatus === "unknown" && isCurrentParentTurn && isParentTurnInProgress);
  if (isActive) return "active";

  const isWaiting = normalizedStatus === "waiting";
  if (isWaiting) return "waiting";

  const isDone = normalizedStatus === "done"
    || (!input.latestReference.usesThreadStatus && normalizedStatus === "active" && !isParentTurnInProgress)
    || input.childProgress === "notInProgress";
  return isDone ? "done" : null;
}

function getReceiverThreadMap(receiverThreads: readonly CodexMultiAgentReceiverThread[]): Map<string, CodexMultiAgentReceiverThread["thread"]> {
  return new Map(receiverThreads.map((receiverThread) => [receiverThread.threadId, receiverThread.thread]));
}

function normalizeMultiAgentPayloadFromItem(item: CodexConversationItem) {
  const rawPayload = normalizeMultiAgentActionPayload(item.rawItem);
  if (rawPayload) return rawPayload;

  const args = asRecord(item.toolCall?.args);
  if (!args) return null;

  return normalizeMultiAgentActionPayload({
    tool: item.toolCall?.toolName,
    status: item.status,
    senderThreadId: args.sender,
    receiverThreadIds: args.receivers,
    receiverThreads: args.receiverThreads,
    agentsStates: args.agentsStates,
    prompt: args.prompt,
    model: args.model,
    reasoningEffort: args.reasoningEffort,
  });
}

function buildLatestReferenceMap(input: BuildBackgroundSubagentRowsInput): Map<string, BackgroundSubagentLatestReference> {
  const knownChildIds = new Set(input.childMemberships.map((membership) => membership.threadId));
  const latestReferences = new Map<string, BackgroundSubagentLatestReference>();

  input.parentTurns.forEach((turn, turnIndex) => {
    const parentTurnKey = getParentTurnKey(turn, turnIndex);
    for (const item of turn.items) {
      const payload = normalizeMultiAgentPayloadFromItem(item);
      if (!payload) continue;

      const receiverThreads = getReceiverThreadMap(payload.receiverThreads);
      for (const receiverThreadId of payload.receiverThreadIds) {
        if (!knownChildIds.has(receiverThreadId)) continue;

        const previous = latestReferences.get(receiverThreadId);
        latestReferences.set(receiverThreadId, {
          tool: payload.action === "wait" ? (previous?.tool ?? payload.action) : payload.action,
          parentTurnKey,
          thread: receiverThreads.get(receiverThreadId) ?? previous?.thread ?? null,
          agentState: payload.agentsStates[receiverThreadId] ?? previous?.agentState ?? null,
          spawnModel: payload.action === "spawnAgent"
            ? (payload.model ?? previous?.spawnModel ?? null)
            : (previous?.spawnModel ?? null),
          usesThreadStatus: false,
        });
      }
    }
  });

  return latestReferences;
}

function buildFallbackLatestReference(
  parentTurns: readonly CodexConversationTurn[],
  childConversation: CodexConversationSnapshot | null,
): BackgroundSubagentLatestReference {
  return {
    tool: "spawnAgent",
    parentTurnKey: getParentTurnKeyForCreatedAt(parentTurns, childConversation?.createdAt ?? null),
    thread: null,
    agentState: {
      status: childConversation ? mapThreadStatusToAgentStatus(childConversation.statusType) : "completed",
      message: null,
    },
    spawnModel: null,
    usesThreadStatus: childConversation !== null,
  };
}

function resolveDisplayName(input: {
  membership: CodexConversationChildMembership;
  latestReference: BackgroundSubagentLatestReference;
  childConversation: CodexConversationSnapshot | null;
}): string {
  const displayName = normalizeOptionalText(input.membership.displayName)
    ?? resolveThreadDisplayName(input.latestReference.thread)
    ?? resolveThreadDisplayName(input.membership.thread)
    ?? normalizeOptionalText(input.childConversation?.agentNickname)
    ?? input.membership.threadId;
  return stripLeadingAt(displayName);
}

function resolveAgentRole(input: {
  membership: CodexConversationChildMembership;
  latestReference: BackgroundSubagentLatestReference;
  childConversation: CodexConversationSnapshot | null;
}): string | null {
  const role = normalizeOptionalText(input.latestReference.thread?.agentRole)
    ?? normalizeOptionalText(input.membership.thread?.agentRole)
    ?? normalizeOptionalText(input.childConversation?.agentRole);
  if (!role || role === "default") return null;
  return role;
}

function unwrapMarkdownDelimiters(value: string): string {
  let current = value;
  for (;;) {
    const next = current
      .replace(/^\*\*(.+)\*\*$/u, "$1")
      .replace(/^__(.+)__$/u, "$1")
      .replace(/^\*(.+)\*$/u, "$1")
      .replace(/^_(.+)_$/u, "$1")
      .replace(/^`(.+)`$/u, "$1")
      .trim();
    if (next === current) return current;
    current = next;
  }
}

export function cleanupBackgroundSubagentStatusSummary(value: string | null | undefined): string | null {
  if (value == null) return null;
  let text = value
    .replace(/^\s*(?:>\s*|#{1,6}\s+|(?:[-*+]|\d+\.)\s+)*/u, "")
    .replace(/\*/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
  text = unwrapMarkdownDelimiters(text);
  text = text.replace(/^(?:i['’]m|i am)\s+/iu, "");
  text = text.replace(/[.!?;,:]+$/u, "").trim();
  if (text.replace(/[*_`]/gu, "").trim().length === 0) return null;
  if (/^\p{Lu}\p{Ll}/u.test(text)) {
    text = `${text[0]?.toLowerCase() ?? ""}${text.slice(1)}`;
  }
  return text;
}

function getReasoningSummaryCandidates(item: CodexConversationItem): string[] {
  const candidates: string[] = [];
  const rawItem = asRecord(item.rawItem);
  const summary = rawItem?.summary;
  if (Array.isArray(summary)) {
    for (const entry of summary) {
      if (typeof entry === "string") candidates.push(entry);
      if (typeof entry === "object" && entry !== null && typeof (entry as { text?: unknown }).text === "string") {
        candidates.push((entry as { text: string }).text);
      }
    }
  }
  if (typeof item.markdownText === "string") {
    candidates.push(item.markdownText);
  }
  return candidates;
}

function resolveStatusSummary(childConversation: CodexConversationSnapshot | null): string | null {
  const latestTurn = childConversation?.turns.at(-1) ?? null;
  if (latestTurn?.status !== "inProgress") return null;

  for (let itemIndex = latestTurn.items.length - 1; itemIndex >= 0; itemIndex -= 1) {
    const item = latestTurn.items[itemIndex];
    if (item?.semanticKind !== "reasoning" && item?.type !== "reasoning") continue;

    const candidates = getReasoningSummaryCandidates(item);
    for (let candidateIndex = candidates.length - 1; candidateIndex >= 0; candidateIndex -= 1) {
      const summary = cleanupBackgroundSubagentStatusSummary(candidates[candidateIndex]);
      if (summary) return summary;
    }
  }

  return null;
}

function summarizeTurnDiff(diff: string | null | undefined): ThreadComposerShellBackgroundAgentRowModel["diffStats"] {
  if (!diff) return null;

  let linesAdded = 0;
  let linesRemoved = 0;
  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) linesAdded += 1;
    if (line.startsWith("-")) linesRemoved += 1;
  }

  return linesAdded === 0 && linesRemoved === 0 ? null : { linesAdded, linesRemoved };
}

function resolveDiffStats(childConversation: CodexConversationSnapshot | null): ThreadComposerShellBackgroundAgentRowModel["diffStats"] {
  return summarizeTurnDiff(childConversation?.turns.at(-1)?.diff);
}

export function buildBackgroundSubagentRows(
  input: BuildBackgroundSubagentRowsInput,
): ThreadComposerShellBackgroundAgentRowModel[] {
  const latestReferences = buildLatestReferenceMap(input);
  const currentParentTurnKey = getLatestParentTurnKey(input.parentTurns);
  const inProgressParentTurnKeys = getInProgressParentTurnKeys(input.parentTurns);

  return input.childMemberships.flatMap((membership) => {
    const childConversation = input.knownConversationsById[membership.threadId] ?? null;
    if (childConversation?.archived) {
      return [];
    }

    const latestReference = latestReferences.get(membership.threadId)
      ?? buildFallbackLatestReference(input.parentTurns, childConversation);
    const status = resolveVisibleStatus({
      latestReference,
      childProgress: resolveChildProgress(childConversation),
      currentParentTurnKey,
      inProgressParentTurnKeys,
    });
    if (!status) return [];

    const displayName = resolveDisplayName({ membership, latestReference, childConversation });
    return [{
      conversationId: membership.threadId,
      parentTurnKey: latestReference.parentTurnKey,
      displayName,
      actorName: normalizeOptionalText(membership.actorName) ?? displayName,
      agentRole: resolveAgentRole({ membership, latestReference, childConversation }),
      spawnModel: latestReference.spawnModel,
      status,
      statusSummary: status === "active" ? resolveStatusSummary(childConversation) : null,
      showInlineActivity: membership.showInlineActivity === true,
      diffStats: resolveDiffStats(childConversation),
      role: membership.role,
    }];
  });
}
