import type { CodexConversationItem, CodexConversationTurn } from "../../../lib/types";
import { groupAgentEntries } from "./group-exploration-blocks";
import type {
  ThreadAgentEntryModel,
  ThreadBlockModel,
  ThreadExplorationGroupBlockModel,
  ThreadSearchUnitModel,
  ThreadThinkingPlaceholderBlockModel,
  ThreadTranscriptBlockModel,
  ThreadTurnModel,
  ThreadTurnRenderBuckets,
} from "../thread-stage-types";

interface BuildTurnViewModelInput {
  turnId: string;
  turn: CodexConversationTurn | null;
  buckets: ThreadTurnRenderBuckets;
  isLatestTurn: boolean;
  isStreamingTurn: boolean;
  isBlocked: boolean;
  canEditTurnUserPrefix?: boolean;
  canForkTurnUserPrefix?: boolean;
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
      if (block.type === "explorationGroup" || block.type === "multiAgentGroup") {
        return [
          block.summary,
          ...block.entries.map((entry) => entry.markdownText ?? ""),
          ...block.entries.map((entry) => stringifyToolCall(entry)),
        ];
      }
      if ("entry" in block) {
        return [block.searchableText];
      }
      return [block.searchableText];
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
  if (block.type === "explorationGroup" || block.type === "multiAgentGroup" || block.type === "thinkingPlaceholder") return block;
  if (block.type !== "userMessage" && block.type !== "assistantMessage") return block;

  const nextBlock = {
    ...block,
    searchUnitKey,
  } satisfies ThreadTranscriptBlockModel;

  return nextBlock as TBlock;
}

function applyUserMessageActions(
  userItems: ThreadTranscriptBlockModel[],
  input: Pick<BuildTurnViewModelInput, "canEditTurnUserPrefix" | "canForkTurnUserPrefix">,
): ThreadTranscriptBlockModel[] {
  if (userItems.length === 0) return userItems;

  return userItems.map((block, index) => ({
    ...block,
    userMessageActions: {
      canEdit: Boolean(input.canEditTurnUserPrefix) && index === userItems.length - 1,
      canFork: Boolean(input.canForkTurnUserPrefix),
    },
  }));
}

function applyAssistantMessageActions(
  assistantItem: ThreadTranscriptBlockModel | null,
  input: Pick<BuildTurnViewModelInput, "isStreamingTurn">,
): ThreadTranscriptBlockModel | null {
  if (!assistantItem || assistantItem.type !== "assistantMessage") return assistantItem;

  const hasCopyableContent = (assistantItem.entry.markdownText?.trim().length ?? 0) > 0;
  const showAssistantMessageActions = !input.isStreamingTurn && hasCopyableContent;

  return {
    ...assistantItem,
    showAssistantMessageActions,
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
    buckets.assistantItem
      ? [{
          key: `${turnId}:assistant`,
          turnId,
          text: buckets.assistantItem.searchableText.trim(),
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
  if (!entry || entry.type === "explorationGroup" || entry.type === "multiAgentGroup") return false;
  if (entry.type !== "reasoning") return false;
  return entry.status === "inProgress";
}

function hasIncompleteNonAgentBlock(
  buckets: ThreadTurnRenderBuckets,
  isStreamingTurn: boolean,
): boolean {
  return [
    buckets.assistantItem,
    buckets.proposedPlanItem,
    buckets.todoListItem,
    buckets.unifiedDiffItem,
    ...buckets.postAssistantItems,
    ...buckets.mcpServerElicitationItems,
  ].some((block) => isIncompleteBlock(block, isStreamingTurn));
}

function reconcileExplorationState(
  groupedAgentItems: ThreadAgentEntryModel[],
  buckets: ThreadTurnRenderBuckets,
  input: Pick<BuildTurnViewModelInput, "isStreamingTurn" | "isBlocked">,
): {
  groupedAgentItems: ThreadAgentEntryModel[];
  isExploring: boolean;
  hasWorkedForItem: boolean;
  isAnyNonExploringAgentItemInProgress: boolean;
} {
  const hasWorkedForItem = groupedAgentItems.some((entry) => "entry" in entry && entry.type === "workedFor");
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
    hasWorkedForItem,
    isAnyNonExploringAgentItemInProgress,
  };
}

function resolveThinkingPlaceholderItem(
  turnId: string,
  buckets: ThreadTurnRenderBuckets,
  input: Pick<BuildTurnViewModelInput, "isStreamingTurn" | "isBlocked"> & {
    isExploring: boolean;
    hasWorkedForItem: boolean;
    isAnyNonExploringAgentItemInProgress: boolean;
  },
): ThreadThinkingPlaceholderBlockModel | null {
  if (!input.isStreamingTurn || input.isBlocked) return null;
  if (input.hasWorkedForItem) return null;
  if (input.isExploring) return null;

  if (isIncompleteBlock(buckets.proposedPlanItem, input.isStreamingTurn)) return null;
  if (isIncompleteBlock(buckets.assistantItem, input.isStreamingTurn)) return buildThinkingPlaceholderItem(turnId);
  if (input.isAnyNonExploringAgentItemInProgress) return null;

  return buildThinkingPlaceholderItem(turnId);
}

export function buildTurnViewModel(input: BuildTurnViewModelInput): ThreadTurnModel {
  const groupedAgentItems = groupAgentEntries(input.buckets.agentItems);
  const explorationState = reconcileExplorationState(groupedAgentItems, input.buckets, input);
  const renderableCollapsedEntries = explorationState.groupedAgentItems.filter((entry) => {
    if ("entry" in entry && entry.type === "workedFor") return false;
    return true;
  });
  const workedForEntry = explorationState.groupedAgentItems.find((entry) =>
    "entry" in entry
    && entry.type === "workedFor"
    && typeof entry.entry.timeLabel === "string"
    && entry.entry.timeLabel.trim().length > 0);
  const workedForTimeLabel =
    workedForEntry && "entry" in workedForEntry && workedForEntry.type === "workedFor"
      ? workedForEntry.entry.timeLabel?.trim() ?? null
      : null;
  const isCompletedTurn = input.turn?.status === "completed";
  const isCancelledTurn = input.turn?.status === "interrupted";

  let buckets: ThreadTurnRenderBuckets = {
    ...input.buckets,
    thinkingPlaceholderItem: resolveThinkingPlaceholderItem(input.turnId, input.buckets, {
      ...input,
      isExploring: explorationState.isExploring,
      hasWorkedForItem: explorationState.hasWorkedForItem,
      isAnyNonExploringAgentItemInProgress: explorationState.isAnyNonExploringAgentItemInProgress,
    }),
  };

  const searchUnits = buildSearchUnits(buckets, input.turnId);
  const userSearchUnitKeys = searchUnits
    .filter((unit) => unit.blockType === "userMessage")
    .map((unit) => unit.key);
  const assistantSearchUnitKey = searchUnits.find((unit) => unit.blockType === "assistantMessage")?.key;

  buckets = {
    ...buckets,
    userItems: applyUserMessageActions(
      buckets.userItems.map((block, index) =>
        withSearchUnitKey(block, userSearchUnitKeys[index] ?? `${input.turnId}:user:${index}`)),
      input,
    ),
    assistantItem: applyAssistantMessageActions(
      withSearchUnitKey(buckets.assistantItem, assistantSearchUnitKey ?? `${input.turnId}:assistant`),
      input,
    ),
  };

  const leadingBlocks: ThreadBlockModel[] = [
    ...buckets.modelChangedItems,
    ...buckets.preUserItems,
    ...buckets.userItems,
    ...buckets.modelReroutedItems,
  ];
  const aboveComposerBlocks = resolveAboveComposerBlocks(buckets, input);
  const portalBlockIds = new Set(aboveComposerBlocks.map((block) => block.id));
  const trailingBlocks: ThreadBlockModel[] = [
    ...(buckets.systemEventItem ? [buckets.systemEventItem] : []),
    ...(buckets.assistantItem ? [buckets.assistantItem] : []),
    ...buckets.postAssistantItems,
    ...buckets.mcpServerElicitationItems,
    ...(buckets.proposedPlanItem ? [buckets.proposedPlanItem] : []),
    ...(buckets.todoListItem ? [buckets.todoListItem] : []),
    ...(buckets.thinkingPlaceholderItem ? [buckets.thinkingPlaceholderItem] : []),
    ...(buckets.unifiedDiffItem ? [buckets.unifiedDiffItem] : []),
    ...buckets.remoteTaskCreatedItems,
    ...buckets.personalityChangedItems,
    ...buckets.forkedFromConversationItems,
  ].filter((block) => !portalBlockIds.has(block.id));
  const resolvedBlocks = flattenBlocks(leadingBlocks, explorationState.groupedAgentItems, trailingBlocks);
  const hasRenderableAgentBodyEntries =
    renderableCollapsedEntries.length > 0
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
    isLatestTurn: input.isLatestTurn,
    isStreamingTurn: input.isStreamingTurn,
    isBlocked: input.isBlocked,
    searchableText: collectSearchableText(resolvedBlocks),
    searchUnits,
    hasRenderableAgentBodyEntries,
    defaultAgentBodyCollapsed: hasRenderableAgentBodyEntries && !input.isLatestTurn,
    collapsedMessageCount: renderableCollapsedEntries.length,
    workedForTimeLabel,
  };
}
