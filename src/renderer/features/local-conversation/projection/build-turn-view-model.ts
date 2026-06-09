import type { CodexConversationItem, CodexConversationTurn } from "../../../lib/types";
import { groupAgentEntries } from "./group-exploration-blocks";
import type {
  ThreadAssistantActionsBlockModel,
  ThreadAssistantMessageActionsModel,
  ThreadAgentItemModel,
  ThreadAgentEntryModel,
  ThreadBlockModel,
  ThreadExplorationGroupBlockModel,
  ThreadSearchUnitModel,
  ThreadThinkingPlaceholderBlockModel,
  ThreadTranscriptBlockModel,
  ThreadTurnModel,
  ThreadTurnRenderBuckets,
  ThreadUserAttachmentStripBlockModel,
  ThreadWorkedForBlockModel,
} from "../thread-stage-types";
import type { ThreadWorkedForTiming } from "../thread-worked-for-time";

interface BuildTurnViewModelInput {
  turnId: string;
  turn: CodexConversationTurn | null;
  buckets: ThreadTurnRenderBuckets;
  workedForItem?: ThreadWorkedForBlockModel | null;
  workedForTiming?: ThreadWorkedForTiming | null;
  workedDurationMs?: number | null;
  isLatestTurn: boolean;
  isStreamingTurn: boolean;
  isBlocked: boolean;
  canEditTurnUserPrefix?: boolean;
  canForkTurn?: boolean;
}

function buildThinkingPlaceholderItem(turnId: string): ThreadThinkingPlaceholderBlockModel {
  const now = Date.now();
  return {
    id: `${turnId}:thinking`,
    turnId,
    createdAt: now,
    updatedAt: now,
    searchableText: "",
    type: "thinkingPlaceholder",
  };
}

function flattenBlocks(
  leadingBlocks: ThreadBlockModel[],
  agentBodyEntries: ThreadAgentEntryModel[],
  trailingBlocks: ThreadBlockModel[],
): ThreadBlockModel[] {
  return [...leadingBlocks, ...agentBodyEntries, ...trailingBlocks];
}

function resolveAboveComposerBlocks(
  buckets: ThreadTurnRenderBuckets,
  input: Pick<BuildTurnViewModelInput, "isStreamingTurn" | "isBlocked">,
): ThreadBlockModel[] {
  if (!input.isStreamingTurn || input.isBlocked) return [];

  return [
    ...(buckets.todoListItem ? [buckets.todoListItem] : []),
    ...(buckets.unifiedDiffItem ? [buckets.unifiedDiffItem] : []),
  ];
}

function stringifyToolCall(entry: CodexConversationItem): string {
  if (entry.kind === "commandExecution") {
    return [
      entry.command ?? "",
      entry.cwd ?? "",
      entry.aggregatedOutput ?? "",
    ]
      .map((segment) => segment.trim())
      .filter((segment) => segment.length > 0)
      .join(" ");
  }

  return [
    entry.toolCall?.toolName ?? "",
    entry.toolCall?.server ?? "",
    typeof entry.toolCall?.result === "string" ? entry.toolCall.result : "",
  ]
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
    .join(" ");
}

function collectSearchableText(blocks: ThreadBlockModel[]): string {
  return blocks
    .flatMap((block) => {
      const nestedAssistantAfter =
        block.type === "assistantMessage" && block.assistantAfterBlocks
          ? collectSearchableText(block.assistantAfterBlocks)
          : "";
      if (block.type === "explorationGroup" || block.type === "multiAgentGroup") {
        return [
          block.summary,
          ...block.entries.map((entry) => entry.markdownText ?? ""),
          ...block.entries.map((entry) => stringifyToolCall(entry)),
          nestedAssistantAfter,
        ];
      }
      if (block.type === "pendingMcpToolCalls" || block.type === "dynamicToolCallGroup") {
        return [
          block.summary,
          ...block.entries.map((entry) => entry.searchableText),
          nestedAssistantAfter,
        ];
      }
      if (block.type === "collapsedToolActivity") {
        return [
          block.summary,
          ...block.entries.flatMap((entry) =>
            entry.type === "explorationGroup"
              ? [entry.summary, ...entry.entries.map((item) => item.markdownText ?? ""), ...entry.entries.map((item) => stringifyToolCall(item))]
              : [entry.searchableText],
          ),
          nestedAssistantAfter,
        ];
      }
      if ("entry" in block) {
        return [block.searchableText, nestedAssistantAfter];
      }
      return [block.searchableText, nestedAssistantAfter];
    })
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
    .join("\n");
}

function withSearchUnitKey<TBlock extends ThreadBlockModel | null>(
  block: TBlock,
  searchUnitKey: string,
): TBlock {
  if (!block) return block;
  if (
    block.type === "explorationGroup"
    || block.type === "multiAgentGroup"
    || block.type === "pendingMcpToolCalls"
    || block.type === "dynamicToolCallGroup"
    || block.type === "collapsedToolActivity"
    || block.type === "assistantActions"
    || block.type === "thinkingPlaceholder"
  ) return block;
  if (block.type !== "userMessage" && block.type !== "assistantMessage") return block;

  const nextBlock = {
    ...block,
    searchUnitKey,
  } satisfies ThreadTranscriptBlockModel;

  return nextBlock as TBlock;
}

function resolveTimestampMs(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function resolveUserMessageSentAt(turn: CodexConversationTurn | null, index: number): number | null {
  if (index !== 0) return null;
  return resolveTimestampMs(turn?.turnStartedAtMs);
}

function resolveAssistantMessageSentAt(
  turn: CodexConversationTurn | null,
): number | null {
  return resolveTimestampMs(turn?.finalAssistantStartedAtMs);
}

function applyUserMessageActions(
  userItems: ThreadTranscriptBlockModel[],
  input: Pick<BuildTurnViewModelInput, "canEditTurnUserPrefix" | "turn">,
): ThreadTranscriptBlockModel[] {
  if (userItems.length === 0) return userItems;

  return userItems.map((block, index) => ({
    ...block,
    userMessageActions: {
      canEdit: Boolean(input.canEditTurnUserPrefix) && index === userItems.length - 1,
      sentAtMs: resolveUserMessageSentAt(input.turn, index),
    },
  }));
}

function buildUserAttachmentStripBlock(
  block: ThreadTranscriptBlockModel,
): ThreadUserAttachmentStripBlockModel | null {
  const attachments = block.entry.userAttachments ?? [];
  if (attachments.length === 0) return null;

  return {
    id: `${block.id}:attachments`,
    turnId: block.turnId,
    createdAt: block.createdAt,
    updatedAt: block.updatedAt,
    searchableText: "",
    type: "userAttachmentStrip",
    attachments,
  };
}

function expandUserBlocksWithAttachmentStrips(
  userItems: ThreadTranscriptBlockModel[],
): ThreadBlockModel[] {
  return userItems.flatMap((block) => {
    const strip = buildUserAttachmentStripBlock(block);
    return strip ? [strip, block] : [block];
  });
}

function buildAssistantMessageActionsModel(
  assistantItem: ThreadTranscriptBlockModel | null,
  input: Pick<BuildTurnViewModelInput, "canForkTurn" | "isStreamingTurn" | "turn">,
): ThreadAssistantMessageActionsModel | null {
  if (!assistantItem || assistantItem.type !== "assistantMessage") return null;

  const copyText = assistantItem.entry.markdownText?.trim() ?? "";
  const hasCopyableContent = copyText.length > 0;
  const isCompleted = !input.isStreamingTurn && assistantItem.status !== "inProgress";
  const canFork = isCompleted && Boolean(input.canForkTurn);
  const canRate = isCompleted && hasCopyableContent;

  if (!canFork && !(isCompleted && hasCopyableContent)) return null;

  return {
    copyText: hasCopyableContent && isCompleted ? copyText : null,
    sentAtMs: resolveAssistantMessageSentAt(input.turn),
    canRate,
    canFork,
  };
}

function applyAssistantMessageActions(
  assistantItem: ThreadTranscriptBlockModel | null,
  input: Pick<BuildTurnViewModelInput, "canForkTurn" | "isStreamingTurn" | "turn">,
): ThreadTranscriptBlockModel | null {
  if (!assistantItem || assistantItem.type !== "assistantMessage") return assistantItem;

  const assistantMessageActions = buildAssistantMessageActionsModel(assistantItem, input);
  if (!assistantMessageActions) return assistantItem;

  return {
    ...assistantItem,
    assistantMessageActions,
  };
}

function applyAssistantAfterBlocks(
  assistantItem: ThreadTranscriptBlockModel | null,
  assistantAfterBlocks: ThreadBlockModel[],
): ThreadTranscriptBlockModel | null {
  if (!assistantItem || assistantItem.type !== "assistantMessage") return assistantItem;
  if (assistantAfterBlocks.length === 0) return assistantItem;

  return {
    ...assistantItem,
    assistantAfterBlocks,
  };
}

function buildDeferredAssistantActionsBlock(
  assistantItem: ThreadTranscriptBlockModel | null,
  input: Pick<BuildTurnViewModelInput, "canForkTurn" | "isStreamingTurn" | "turn">,
): ThreadAssistantActionsBlockModel | null {
  if (!assistantItem || assistantItem.type !== "assistantMessage") return null;

  const actions = buildAssistantMessageActionsModel(assistantItem, input);
  if (!actions) return null;

  return {
    id: `${assistantItem.id}:actions`,
    turnId: assistantItem.turnId,
    createdAt: assistantItem.createdAt,
    updatedAt: assistantItem.updatedAt,
    searchableText: "",
    type: "assistantActions",
    entry: assistantItem.entry,
    actions,
  };
}

function buildSearchUnits(buckets: ThreadTurnRenderBuckets, turnId: string): ThreadSearchUnitModel[] {
  const userUnits = buckets.userItems.flatMap((block, index) => {
    const text = block.searchableText.trim();
    if (!text) return [];
    return [{
      key: `${turnId}:user:${index}`,
      turnId,
      text,
      blockType: "userMessage" as const,
    }];
  });

  const assistantUnits =
    buckets.latestAssistantMessage
      ? [{
          key: `${turnId}:assistant`,
          turnId,
          text: buckets.latestAssistantMessage.searchableText.trim(),
          blockType: "assistantMessage" as const,
        }].filter((unit) => unit.text.length > 0)
      : [];

  return [...userUnits, ...assistantUnits];
}

function isIncompleteBlock(
  block: ThreadTranscriptBlockModel | null,
  isStreamingTurn: boolean,
): boolean {
  if (!block || !isStreamingTurn) return false;
  if (block.status) return block.status === "inProgress";
  return true;
}

function isTrailingReasoningEntryInProgress(entry: ThreadAgentEntryModel | undefined): boolean {
  if (!entry || entry.type === "explorationGroup" || entry.type === "multiAgentGroup" || entry.type === "collapsedToolActivity") return false;
  if (entry.type !== "reasoning") return false;
  return entry.status === "inProgress";
}

function hasIncompleteNonAgentBlock(
  buckets: ThreadTurnRenderBuckets,
  isStreamingTurn: boolean,
): boolean {
  const candidateBlocks = [
    buckets.assistantItem,
    buckets.latestAssistantMessage && buckets.latestAssistantMessage !== buckets.assistantItem
      ? buckets.latestAssistantMessage
      : null,
    buckets.proposedPlanItem,
    buckets.todoListItem,
    buckets.unifiedDiffItem,
    ...buckets.postAssistantItems,
    ...buckets.mcpServerElicitationItems,
  ];

  return candidateBlocks.some((block) => isIncompleteBlock(block, isStreamingTurn));
}

function reconcileExplorationState(
  groupedAgentItems: ThreadAgentEntryModel[],
  buckets: ThreadTurnRenderBuckets,
  input: Pick<BuildTurnViewModelInput, "isStreamingTurn" | "isBlocked">,
): {
  groupedAgentItems: ThreadAgentEntryModel[];
  isExploring: boolean;
  isAnyNonExploringAgentItemInProgress: boolean;
} {
  const trailingEntry = groupedAgentItems[groupedAgentItems.length - 1];
  const hasTrailingExplorationGroup = trailingEntry?.type === "explorationGroup";
  const trailingExplorationGroup = hasTrailingExplorationGroup ? trailingEntry as ThreadExplorationGroupBlockModel : null;
  const nonAgentBlockInProgress = hasIncompleteNonAgentBlock(buckets, input.isStreamingTurn);
  const explorationEntryInProgress = trailingExplorationGroup?.entries.some((entry) => entry.status === "inProgress") ?? false;
  const isExploring =
    !input.isBlocked
    && input.isStreamingTurn
    && trailingExplorationGroup !== null
    && (!nonAgentBlockInProgress || explorationEntryInProgress);

  const nextGroupedAgentItems =
    isExploring && trailingExplorationGroup
      ? groupedAgentItems.map((entry, index) => {
          if (index !== groupedAgentItems.length - 1 || entry.type !== "explorationGroup") return entry;
          return {
            ...entry,
            status: "inProgress",
          } satisfies ThreadExplorationGroupBlockModel;
        })
      : groupedAgentItems;

  const trailingResolvedEntry = nextGroupedAgentItems[nextGroupedAgentItems.length - 1];
  const isAnyNonExploringAgentItemInProgress =
    trailingResolvedEntry !== undefined
    && trailingResolvedEntry.type !== "explorationGroup"
    && trailingResolvedEntry.type !== "multiAgentGroup"
    && trailingResolvedEntry.status === "inProgress"
    && !isTrailingReasoningEntryInProgress(trailingResolvedEntry);

  return {
    groupedAgentItems: nextGroupedAgentItems,
    isExploring,
    isAnyNonExploringAgentItemInProgress,
  };
}

function resolveThinkingPlaceholderItem(
  turnId: string,
  buckets: ThreadTurnRenderBuckets,
  input: Pick<BuildTurnViewModelInput, "isStreamingTurn" | "isBlocked"> & {
    isExploring: boolean;
    isAnyNonExploringAgentItemInProgress: boolean;
  },
): ThreadThinkingPlaceholderBlockModel | null {
  if (!input.isStreamingTurn || input.isBlocked) return null;
  if (input.isExploring) return null;
  if (buckets.agentItems.some((block) => block.type === "workedFor")) return null;

  if (isIncompleteBlock(buckets.proposedPlanItem, input.isStreamingTurn)) return null;
  if (isIncompleteBlock(buckets.latestAssistantMessage, input.isStreamingTurn)) {
    return buildThinkingPlaceholderItem(turnId);
  }
  if (input.isAnyNonExploringAgentItemInProgress) return null;

  return buildThinkingPlaceholderItem(turnId);
}

function decorateAssistantBlock(
  block: ThreadTranscriptBlockModel,
  latestAssistantId: string | null,
  assistantSearchUnitKey: string,
  input: Pick<BuildTurnViewModelInput, "canForkTurn" | "isStreamingTurn" | "turn"> & {
    includeActions: boolean;
    assistantAfterBlocks?: ThreadBlockModel[];
  },
): ThreadTranscriptBlockModel {
  if (block.type !== "assistantMessage") return block;
  if (latestAssistantId === null || block.id !== latestAssistantId) return block;

  const blockWithSearchKey = withSearchUnitKey(block, assistantSearchUnitKey);
  const blockWithAfter = applyAssistantAfterBlocks(blockWithSearchKey, input.assistantAfterBlocks ?? []) ?? blockWithSearchKey;
  if (!input.includeActions) return blockWithSearchKey;

  return applyAssistantMessageActions(blockWithAfter, input) ?? blockWithAfter;
}

export function buildTurnViewModel(input: BuildTurnViewModelInput): ThreadTurnModel {
  const workedForItem = input.workedForItem ?? null;
  const workedForTiming = input.workedForTiming ?? null;
  const workedDurationMs = input.workedDurationMs ?? null;
  const isCompletedTurn = input.turn?.status === "completed";
  const isCancelledTurn = input.turn?.status === "interrupted";
  const shouldRenderWorkedForInAgentBody = input.turn?.status === "inProgress";
  const initialVisibleAgentItems = shouldRenderWorkedForInAgentBody
    ? input.buckets.agentItems
    : input.buckets.agentItems.filter((item) => item.type !== "workedFor");
  const initialGroupedAgentItems = groupAgentEntries(initialVisibleAgentItems);
  const initialExplorationState = reconcileExplorationState(initialGroupedAgentItems, input.buckets, input);

  let buckets: ThreadTurnRenderBuckets = {
    ...input.buckets,
    thinkingPlaceholderItem: resolveThinkingPlaceholderItem(input.turnId, input.buckets, {
      ...input,
      isExploring: initialExplorationState.isExploring,
      isAnyNonExploringAgentItemInProgress: initialExplorationState.isAnyNonExploringAgentItemInProgress,
    }),
  };

  const searchUnits = buildSearchUnits(buckets, input.turnId);
  const userSearchUnitKeys = searchUnits
    .filter((unit) => unit.blockType === "userMessage")
    .map((unit) => unit.key);
  const assistantSearchUnitKey = searchUnits.find((unit) => unit.blockType === "assistantMessage")?.key ?? `${input.turnId}:assistant`;
  const latestAssistantId = buckets.latestAssistantMessage?.id ?? null;
  const aboveComposerBlocks = resolveAboveComposerBlocks(buckets, input);
  const portalBlockIds = new Set(aboveComposerBlocks.map((block) => block.id));
  const nextAssistantItem =
    buckets.assistantItem === null
      ? null
      : decorateAssistantBlock(buckets.assistantItem, latestAssistantId, assistantSearchUnitKey, {
          ...input,
          includeActions: true,
          assistantAfterBlocks: [
            ...buckets.postAssistantItems,
            ...(buckets.unifiedDiffItem ? [buckets.unifiedDiffItem] : []),
          ].filter((block) => !portalBlockIds.has(block.id)),
        });
  const nextAgentItems = buckets.agentItems.map((block): ThreadAgentItemModel =>
    block.type === "assistantMessage"
      ? decorateAssistantBlock(block, latestAssistantId, assistantSearchUnitKey, {
          ...input,
          includeActions: false,
        })
      : block);
  const nextLatestAssistantMessage =
    nextAssistantItem?.id === latestAssistantId
      ? nextAssistantItem
      : nextAgentItems.find((block): block is ThreadTranscriptBlockModel =>
          block.type === "assistantMessage" && block.id === latestAssistantId
        ) ?? buckets.latestAssistantMessage;
  const deferredAssistantActionsBlock =
    nextAssistantItem === null
      ? buildDeferredAssistantActionsBlock(nextLatestAssistantMessage, input)
      : null;

  buckets = {
    ...buckets,
    userItems: applyUserMessageActions(
      buckets.userItems.map((block, index) =>
        withSearchUnitKey(block, userSearchUnitKeys[index] ?? `${input.turnId}:user:${index}`)),
      input,
    ),
    assistantItem: nextAssistantItem,
    agentItems: nextAgentItems,
    latestAssistantMessage: nextLatestAssistantMessage,
  };
  const visibleAgentItems = shouldRenderWorkedForInAgentBody
    ? buckets.agentItems
    : buckets.agentItems.filter((item) => item.type !== "workedFor");
  const groupedAgentItems = groupAgentEntries(visibleAgentItems);
  const explorationState = reconcileExplorationState(groupedAgentItems, buckets, input);

  const leadingBlocks: ThreadBlockModel[] = [
    ...buckets.modelChangedItems,
    ...buckets.preUserItems,
    ...expandUserBlocksWithAttachmentStrips(buckets.userItems),
    ...buckets.modelReroutedItems,
  ];
  const assistantAfterBlockIds = new Set(
    nextAssistantItem?.assistantAfterBlocks?.map((block) => block.id) ?? [],
  );
  const trailingBlocks: ThreadBlockModel[] = [
    ...(buckets.systemEventItem ? [buckets.systemEventItem] : []),
    ...(buckets.assistantItem ? [buckets.assistantItem] : []),
    ...(deferredAssistantActionsBlock ? [deferredAssistantActionsBlock] : []),
    ...buckets.postAssistantItems,
    ...buckets.mcpServerElicitationItems,
    ...(buckets.proposedPlanItem ? [buckets.proposedPlanItem] : []),
    ...(buckets.todoListItem ? [buckets.todoListItem] : []),
    ...(buckets.thinkingPlaceholderItem ? [buckets.thinkingPlaceholderItem] : []),
    ...(buckets.unifiedDiffItem ? [buckets.unifiedDiffItem] : []),
    ...buckets.remoteTaskCreatedItems,
    ...buckets.personalityChangedItems,
    ...buckets.forkedFromConversationItems,
  ].filter((block) => !portalBlockIds.has(block.id) && !assistantAfterBlockIds.has(block.id));
  const resolvedBlocks = flattenBlocks(leadingBlocks, explorationState.groupedAgentItems, trailingBlocks);
  const hasRenderableAgentBodyEntries =
    explorationState.groupedAgentItems.length > 0
    && !input.isStreamingTurn
    && !isCancelledTurn
    && isCompletedTurn;

  return {
    turnId: input.turnId,
    turn: input.turn,
    buckets,
    leadingBlocks,
    agentBodyEntries: explorationState.groupedAgentItems,
    trailingBlocks,
    blocks: resolvedBlocks,
    aboveComposerBlocks,
    workedForItem,
    workedForTiming,
    workedDurationMs,
    isLatestTurn: input.isLatestTurn,
    isStreamingTurn: input.isStreamingTurn,
    isBlocked: input.isBlocked,
    searchableText: collectSearchableText(resolvedBlocks),
    searchUnits,
    hasRenderableAgentBodyEntries,
    defaultAgentBodyCollapsed: hasRenderableAgentBodyEntries && !input.isLatestTurn,
    collapsedMessageCount: explorationState.groupedAgentItems.length,
  };
}
