import type {
  CodexConversationTurn,
  ProtocolAppInfo,
  ProtocolListMcpServerStatusResponse,
} from "../../../lib/types";
import { stripCodexRemarkDirectiveLines } from "../../../../shared/codex-remark-directives";
import {
  attachAutomaticApprovalReviewsToToolTargets,
  buildV2AgentActivityGroupBlock,
  materializeAgentRenderUnits,
  resolveAgentActivityGroupActiveSummary,
} from "./agent-activity-group";
import {
  buildThreadAgentActivityTargetAttribute,
  buildThreadAgentActivityUnits,
  filterThreadAgentActivityGroupBodyItems,
  isThreadClassifiableActivityItem,
  projectThreadIndexedAgentActivityItems,
  type ThreadClassifiableActivityItem,
} from "./agent-activity-v2";
import {
  formatThreadAgentActivityGroupHeader,
  resolveThreadAgentActivityGroupState,
} from "./agent-activity-v2-summary";
import { resolveGeneratedImageOutputState } from "./generated-image-output";
import { collectHookFeedbackSources } from "./hook-feedback-settings";
import type {
  ThreadAssistantActionsBlockModel,
  ThreadAssistantMessageActionsModel,
  ThreadAgentEntryModel,
  ThreadAgentItemModel,
  ThreadAgentRenderUnit,
  ThreadBlockModel,
  ThreadGeneratedImageGalleryBlockModel,
  ThreadLiveActivityPresentation,
  ThreadSearchUnitModel,
  ThreadTranscriptBlockModel,
  ThreadTurnModel,
  ThreadTurnRenderBuckets,
  ThreadTurnSubagentActivityState,
  ThreadUserAttachmentStripBlockModel,
  ThreadWorkedForBlockModel,
} from "../thread-stage-types";
import {
  resolveThreadLiveActivityInputState,
  resolveThreadLiveActivityPresentation,
} from "./thread-live-activity";
import type { ThreadWorkedForTiming } from "../thread-worked-for-time";
import {
  extractCommandActions,
  isExplorationAction,
} from "./tool-metadata/command-actions";

interface BuildTurnViewModelInput {
  turnId: string | null;
  turnKey?: string;
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
  mcpServerStatuses?: ProtocolListMcpServerStatusResponse | null;
  endResourcePaths?: readonly string[];
  subagentActivityState?: ThreadTurnSubagentActivityState;
}

const EMPTY_SUBAGENT_ACTIVITY_STATE: ThreadTurnSubagentActivityState = {
  hasActivity: false,
  hasActiveActivity: false,
};

function flattenBlocks(
  leadingBlocks: ThreadBlockModel[],
  agentBodyUnits: ThreadAgentRenderUnit[],
  trailingBlocks: ThreadBlockModel[],
): ThreadBlockModel[] {
  return [...leadingBlocks, ...materializeAgentRenderUnits(agentBodyUnits), ...trailingBlocks];
}

function resolveAboveComposerBlocks(
  buckets: ThreadTurnRenderBuckets,
  input: Pick<BuildTurnViewModelInput, "isLatestTurn" | "isStreamingTurn" | "isBlocked">,
): ThreadBlockModel[] {
  if (!input.isLatestTurn || !input.isStreamingTurn || input.isBlocked) return [];

  return [
    ...(buckets.todoListItem ? [buckets.todoListItem] : []),
    ...(buckets.unifiedDiffItem ? [buckets.unifiedDiffItem] : []),
  ];
}

function resolveTurnOwnerHiddenBlockIds(
  buckets: ThreadTurnRenderBuckets,
  isStreamingTurn: boolean,
): ReadonlySet<string> {
  const ids = new Set<string>();
  if (buckets.todoListItem) ids.add(buckets.todoListItem.id);
  if (isStreamingTurn && buckets.unifiedDiffItem) ids.add(buckets.unifiedDiffItem.id);
  return ids;
}

function collectSearchableText(blocks: ThreadBlockModel[]): string {
  return blocks
    .flatMap((block) => {
      const nestedAssistantAfter =
        block.type === "assistantMessage" && block.assistantAfterBlocks
          ? collectSearchableText(block.assistantAfterBlocks)
          : "";
      if (block.type === "agentActivityGroup") {
        return [
          block.summary,
          ...block.entries.map((entry) => entry.searchableText),
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
    block.type === "agentActivityGroup"
    || block.type === "assistantActions"
  ) return block;
  if (block.type !== "userMessage" && block.type !== "assistantMessage") return block;

  const nextBlock = {
    ...block,
    searchUnitKey,
  } satisfies ThreadTranscriptBlockModel;

  return nextBlock as TBlock;
}

function isUserMessageBlock(
  block: ThreadAgentItemModel | ThreadTranscriptBlockModel,
): block is ThreadTranscriptBlockModel {
  return block.type === "userMessage";
}

function collectUserMessageSearchBlocks(
  buckets: ThreadTurnRenderBuckets,
): ThreadTranscriptBlockModel[] {
  const seenBlockIds = new Set<string>();
  const blocks: ThreadTranscriptBlockModel[] = [];
  const candidates = [
    ...buckets.userItems,
    ...buckets.agentItems.filter(isUserMessageBlock),
  ];

  for (const block of candidates) {
    if (seenBlockIds.has(block.id)) continue;
    seenBlockIds.add(block.id);
    blocks.push(block);
  }

  return blocks;
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
    ...(block.entry.hookFeedback === true
      ? {
          hookFeedbackSources: collectHookFeedbackSources(
            input.turn?.hookRuns,
            block.entry.markdownText ?? "",
          ),
        }
      : {}),
    userMessageActions: {
      canEdit: Boolean(input.canEditTurnUserPrefix)
        && block.entry.hookFeedback !== true
        && index === userItems.length - 1,
      sentAtMs: block.entry.deliveryStatus === "not-sent"
        ? null
        : resolveUserMessageSentAt(input.turn, index),
    },
  }));
}

function buildGeneratedImageGalleryBlock(
  turnId: string | null,
  turnKey: string,
  buckets: ThreadTurnRenderBuckets,
  input: Pick<BuildTurnViewModelInput, "endResourcePaths" | "isStreamingTurn">,
): ThreadGeneratedImageGalleryBlockModel | null {
  const output = resolveGeneratedImageOutputState({
    items: buckets.toolOutputItems.map((block) => block.entry),
    endResourcePaths: input.endResourcePaths ?? [],
    isTurnInProgress: input.isStreamingTurn,
  });
  if (!output.shouldRender) return null;

  const images = output.visibleCompletedItems.flatMap((item) => {
    const src = item.generatedImage?.src;
    return src == null ? [] : [{ id: item.itemId, src }];
  });
  const timestamps = buckets.toolOutputItems.flatMap((item) => [
    item.createdAt,
    item.updatedAt,
  ]);
  const createdAt = timestamps.length === 0 ? Date.now() : Math.min(...timestamps);
  const updatedAt = timestamps.length === 0 ? createdAt : Math.max(...timestamps);

  return {
    id: `${turnKey}:generated-image-gallery`,
    turnId,
    createdAt,
    updatedAt,
    // Generated image sources can be data URIs or signed asset URLs. They are
    // transport details, not user-authored searchable transcript content.
    searchableText: "",
    type: "generatedImageGallery",
    images,
    pendingImageCount: output.pendingImageCount,
  };
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
  if (assistantItem.entry.assistantPhase === "commentary") return null;

  const copyText = stripCodexRemarkDirectiveLines(assistantItem.entry.markdownText);
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

function buildSearchUnits(input: {
  buckets: ThreadTurnRenderBuckets;
  turnId: string | null;
  turnKey: string;
  userMessageBlocks: ThreadTranscriptBlockModel[];
}): ThreadSearchUnitModel[] {
  const userUnits = input.userMessageBlocks.map((block, index) => ({
    key: `${input.turnKey}:user:${index}`,
    turnId: input.turnId,
    turnKey: input.turnKey,
    text: block.searchableText.trim(),
    blockType: "userMessage" as const,
  }));

  const assistantUnits =
    input.buckets.latestAssistantMessage
      ? [{
          key: `${input.turnKey}:assistant`,
          turnId: input.turnId,
          turnKey: input.turnKey,
          text: input.buckets.latestAssistantMessage.searchableText.trim(),
          blockType: "assistantMessage" as const,
        }].filter((unit) => unit.text.length > 0)
      : [];

  return [...userUnits, ...assistantUnits];
}

export function buildV2AgentRenderUnits(
  agentItems: readonly ThreadAgentItemModel[],
  options: {
    mcpApps?: readonly ProtocolAppInfo[];
    mcpServerStatuses?: ProtocolListMcpServerStatusResponse | null;
    isTurnCancelled?: boolean;
    liveActivity?: {
      isActivitySliceClosed: boolean;
      isExploring: boolean;
      isTurnInProgress: boolean;
      reasoningFallbackLabel?: string;
    };
  } = {},
): {
  sourceItems: ThreadClassifiableActivityItem[];
  units: ThreadAgentRenderUnit[];
} {
  const workedForItems = agentItems.filter(
    (item): item is ThreadWorkedForBlockModel => item.type === "workedFor",
  );
  const activityItems = agentItems.filter((item) => item.type !== "workedFor");
  const attachedEntries = attachAutomaticApprovalReviewsToToolTargets([...activityItems]);
  const sourceItems = attachedEntries.filter(
    (entry): entry is ThreadClassifiableActivityItem =>
      ("entry" in entry || entry.type === "workedFor")
      && isThreadClassifiableActivityItem(entry as ThreadAgentItemModel),
  );
  const activityUnits = buildThreadAgentActivityUnits(
    projectThreadIndexedAgentActivityItems(sourceItems, {
      mcpServerStatuses: options.mcpServerStatuses ?? null,
    }),
  );
  const units = activityUnits.map((unit, unitIndex): ThreadAgentRenderUnit => {
    const targetAttributes = buildThreadAgentActivityTargetAttribute(unit);
    if (unit.kind === "standalone") {
      return {
        kind: "entry",
        targetAttributes,
        block: {
          ...unit.item.item,
          renderKey: unit.key,
        },
      };
    }

    const entries = unit.items.map(({ item }) => {
      if (item.type === "workedFor") {
        throw new Error("worked-for cannot be groupable in v2 activity");
      }
      return item;
    });
    const body = filterThreadAgentActivityGroupBodyItems(
      unit.items,
      options.isTurnCancelled ?? false,
    );
    const bodyEntries = body.items.map(({ item }) => {
      if (item.type === "workedFor") {
        throw new Error("worked-for cannot be groupable in v2 activity body");
      }
      return item;
    });
    const block = buildV2AgentActivityGroupBlock(entries, unit.key, {
      bodyEntries,
      canExpand: body.canExpand,
      resolvedApps: options.mcpApps,
    });
    const projectedLiveState = options.liveActivity
      ? resolveThreadAgentActivityGroupState({
          unit,
          isLatestVisibleUnit: unitIndex === activityUnits.length - 1,
          isTurnInProgress: options.liveActivity.isTurnInProgress,
          isActivitySliceClosed: options.liveActivity.isActivitySliceClosed,
          isExploring: options.liveActivity.isExploring,
        })
      : { kind: "summary" as const };
    const liveState = projectedLiveState;
    const liveItemSummary = liveState.kind === "active" && "entry" in liveState.item.item
      ? resolveAgentActivityGroupActiveSummary([liveState.item.item])
      : null;
    const liveHeaderKind = liveState.kind === "summary" ? undefined : liveState.kind;
    const defaultRunningLabel = formatThreadAgentActivityGroupHeader({
      state: liveState,
      completedParts: [],
      activeExplorationLabel: liveItemSummary?.label,
      formatMcpToolCall: () => liveItemSummary?.label ?? null,
      formatDynamicToolCall: () => liveItemSummary?.label ?? null,
    });
    const runningSummary = options.liveActivity == null
      ? block.runningSummary
      : liveHeaderKind == null
        ? null
        : {
          kind: "text" as const,
          key: liveState.kind === "thinking"
            ? `${unit.key}:thinking`
            : liveItemSummary?.key ?? `${unit.key}:active`,
          label: liveState.kind === "thinking"
            ? options.liveActivity.reasoningFallbackLabel ?? defaultRunningLabel
            : defaultRunningLabel,
        };

    return {
      kind: "agentActivityGroup",
      targetAttributes,
      block: {
        ...block,
        liveHeaderKind,
        runningSummary,
      },
    };
  });

  const adapterOnlyUnits = attachedEntries.flatMap((entry): ThreadAgentRenderUnit[] => {
    if (!("entry" in entry || entry.type === "workedFor")) return [];
    if (isThreadClassifiableActivityItem(entry as ThreadAgentItemModel)) return [];
    return [{ kind: "entry", block: entry as ThreadAgentItemModel }];
  });

  // workedFor is a timing row, not an activity unit. It is inserted before
  // the first non-user item by buildTurnRenderModel, so preserve that order
  // while keeping it out of the Electron-shaped activity classifier above.
  const workedForUnits: ThreadAgentRenderUnit[] = workedForItems.map((item) => ({
    kind: "entry",
    block: item,
  }));

  return {
    sourceItems,
    units: [...workedForUnits, ...units, ...adapterOnlyUnits],
  };
}

function reconcileExplorationState(
  agentBodyBlocks: ThreadAgentEntryModel[],
  input: Pick<BuildTurnViewModelInput, "isStreamingTurn" | "isBlocked">,
  sourceItems: readonly ThreadClassifiableActivityItem[] = [],
): {
  agentBodyBlocks: ThreadAgentEntryModel[];
  isExploring: boolean;
} {
  const trailingEntry = agentBodyBlocks[agentBodyBlocks.length - 1];
  const trailingV2Group = trailingEntry?.type === "agentActivityGroup" ? trailingEntry : null;
  const trailingV2ExplorationEntries = trailingV2Group?.entries.filter((entry) => {
    if (entry.type !== "exec") return false;
    const actions = extractCommandActions(entry.entry);
    return actions.length > 0 && actions.every(isExplorationAction);
  }) ?? [];
  const isTrailingV2ExplorationGroup = trailingV2Group != null
    && trailingV2ExplorationEntries.length === trailingV2Group.entries.length;
  let hasTrailingSourceExploration = false;
  let trailingSourceExplorationInProgress = false;
  for (const sourceItem of sourceItems) {
    if (sourceItem.type === "exec" && "entry" in sourceItem) {
      const actions = extractCommandActions(sourceItem.entry);
      if (actions.length > 0 && actions.every(isExplorationAction)) {
        hasTrailingSourceExploration = true;
        trailingSourceExplorationInProgress ||= sourceItem.status === "inProgress";
        continue;
      }
    }
    if (sourceItem.type === "reasoning" && hasTrailingSourceExploration) {
      trailingSourceExplorationInProgress ||= sourceItem.status === "inProgress";
      continue;
    }
    hasTrailingSourceExploration = false;
    trailingSourceExplorationInProgress = false;
  }
  const explorationEntryInProgress = (
    trailingV2ExplorationEntries.some((entry) => entry.status === "inProgress")
  ) || trailingSourceExplorationInProgress;
  const isExploring =
    !input.isBlocked
    && input.isStreamingTurn
    && (isTrailingV2ExplorationGroup || hasTrailingSourceExploration)
    && explorationEntryInProgress;

  const nextAgentBodyBlocks = agentBodyBlocks;

  return {
    agentBodyBlocks: nextAgentBodyBlocks,
    isExploring,
  };
}

function reconcileAgentBodyUnitBlocks(
  units: ThreadAgentRenderUnit[],
  blocks: ThreadAgentEntryModel[],
): ThreadAgentRenderUnit[] {
  return units.map((unit, index) => {
    const block = blocks[index];
    if (!block || block === unit.block) return unit;
    return {
      ...unit,
      block: block as ThreadAgentRenderUnit["block"],
    } as ThreadAgentRenderUnit;
  });
}

function hasRenderableAssistantContent(block: ThreadTranscriptBlockModel | null): boolean {
  if (!block || block.type !== "assistantMessage") return false;
  return block.status === "completed"
    || (block.entry.markdownText ?? "").trim().length > 0;
}

function applySubagentCommentaryOwnership(
  buckets: ThreadTurnRenderBuckets,
  subagentActivityState: ThreadTurnSubagentActivityState,
): ThreadTurnRenderBuckets {
  if (!subagentActivityState.hasActivity) return buckets;

  const assistantItem = buckets.assistantItem;
  if (!assistantItem || assistantItem.type !== "assistantMessage") return buckets;
  if (assistantItem.entry.assistantPhase !== "commentary") return buckets;
  if (!hasRenderableAssistantContent(assistantItem)) return buckets;

  return {
    ...buckets,
    assistantItem: null,
    agentItems: [...buckets.agentItems, assistantItem],
  };
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
  const turnKey = input.turnKey ?? input.turnId;
  if (turnKey === null) {
    throw new Error("A nullable local turn requires its occurrence key");
  }
  const workedForItem = input.workedForItem ?? null;
  const workedForTiming = input.workedForTiming ?? null;
  const workedDurationMs = input.workedDurationMs ?? null;
  const subagentActivityState = input.subagentActivityState ?? EMPTY_SUBAGENT_ACTIVITY_STATE;
  const initialBuckets = applySubagentCommentaryOwnership(
    input.buckets,
    subagentActivityState,
  );
  const isCancelledTurn = input.turn?.status === "interrupted";
  const shouldRenderWorkedForInAgentBody = input.turn?.status === "inProgress";
  const initialVisibleAgentItems = shouldRenderWorkedForInAgentBody
    ? initialBuckets.agentItems
    : initialBuckets.agentItems.filter((item) => item.type !== "workedFor");
  const initialAgentBodyUnits = buildV2AgentRenderUnits(
    initialVisibleAgentItems,
    {
      mcpServerStatuses: input.mcpServerStatuses ?? null,
      isTurnCancelled: isCancelledTurn,
    },
  ).units;
  const initialExplorationState = reconcileExplorationState(
    materializeAgentRenderUnits(initialAgentBodyUnits),
    input,
    initialVisibleAgentItems.filter(isThreadClassifiableActivityItem),
  );
  let buckets: ThreadTurnRenderBuckets = { ...initialBuckets };

  const userMessageSearchBlocks = collectUserMessageSearchBlocks(buckets);
  const searchUnits = buildSearchUnits({
    buckets,
    turnId: input.turnId,
    turnKey,
    userMessageBlocks: userMessageSearchBlocks,
  });
  const userSearchUnitKeyByBlockId = new Map(
    userMessageSearchBlocks.map((block, index) => [
      block.id,
      `${turnKey}:user:${index}`,
    ] as const),
  );
  const assistantSearchUnitKey = searchUnits.find((unit) => unit.blockType === "assistantMessage")?.key
    ?? `${turnKey}:assistant`;
  const latestAssistantId = buckets.latestAssistantMessage?.id ?? null;
  const aboveComposerBlocks = resolveAboveComposerBlocks(buckets, input);
  const turnOwnerHiddenBlockIds = resolveTurnOwnerHiddenBlockIds(
    buckets,
    input.isStreamingTurn,
  );
  const generatedImageGalleryBlock = buildGeneratedImageGalleryBlock(
    input.turnId,
    turnKey,
    buckets,
    input,
  );
  const nextAssistantItem =
    buckets.assistantItem === null
      ? null
      : decorateAssistantBlock(buckets.assistantItem, latestAssistantId, assistantSearchUnitKey, {
          ...input,
          includeActions: true,
          assistantAfterBlocks: [
            ...(generatedImageGalleryBlock ? [generatedImageGalleryBlock] : []),
            ...buckets.postAssistantItems,
            ...(buckets.unifiedDiffItem ? [buckets.unifiedDiffItem] : []),
          ].filter((block) => !turnOwnerHiddenBlockIds.has(block.id)),
        });
  const nextAgentItems = buckets.agentItems.map((block): ThreadAgentItemModel => {
    if (block.type === "assistantMessage") {
      return decorateAssistantBlock(block, latestAssistantId, assistantSearchUnitKey, {
          ...input,
          includeActions: false,
      });
    }
    if (block.type === "userMessage") {
      return withSearchUnitKey(
        block,
        userSearchUnitKeyByBlockId.get(block.id) ?? `${turnKey}:user:0`,
      );
    }
    return block;
  });
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
        withSearchUnitKey(
          block,
          userSearchUnitKeyByBlockId.get(block.id) ?? `${turnKey}:user:${index}`,
        )),
      input,
    ),
    assistantItem: nextAssistantItem,
    agentItems: nextAgentItems,
    latestAssistantMessage: nextLatestAssistantMessage,
  };
  const visibleAgentItems = shouldRenderWorkedForInAgentBody
    ? buckets.agentItems
    : buckets.agentItems.filter((item) => item.type !== "workedFor");
  const liveActivityInputState = resolveThreadLiveActivityInputState({
    isLatestTurn: input.isLatestTurn,
    isStreamingTurn: input.isStreamingTurn,
    isBlocked: input.isBlocked,
    showSafetyBufferingUi: input.turn?.safetyBuffering?.showBufferingUi === true,
    latestAssistantMessage: buckets.latestAssistantMessage,
    proposedPlanItem: buckets.proposedPlanItem,
    agentItems: visibleAgentItems,
    isExploring: initialExplorationState.isExploring,
  });
  const v2AgentProjection = buildV2AgentRenderUnits(
    visibleAgentItems,
    {
      mcpServerStatuses: input.mcpServerStatuses ?? null,
      isTurnCancelled: isCancelledTurn,
      liveActivity: {
        isTurnInProgress: input.isStreamingTurn,
        isActivitySliceClosed: liveActivityInputState.isActivitySliceClosed,
        isExploring: initialExplorationState.isExploring,
        reasoningFallbackLabel: liveActivityInputState.reasoningSummary?.text,
      },
    },
  );
  const agentBodyUnitsBeforeReconcile = v2AgentProjection.units;
  const explorationState = reconcileExplorationState(
    materializeAgentRenderUnits(agentBodyUnitsBeforeReconcile),
    input,
    v2AgentProjection.sourceItems,
  );
  const agentBodyUnits = reconcileAgentBodyUnitBlocks(
    agentBodyUnitsBeforeReconcile,
    explorationState.agentBodyBlocks,
  );
  const liveActivity: ThreadLiveActivityPresentation = resolveThreadLiveActivityPresentation({
    isLatestTurn: input.isLatestTurn,
    isStreamingTurn: input.isStreamingTurn,
    isBlocked: input.isBlocked,
    showSafetyBufferingUi: input.turn?.safetyBuffering?.showBufferingUi === true,
    latestAssistantMessage: buckets.latestAssistantMessage,
    proposedPlanItem: buckets.proposedPlanItem,
    agentItems: visibleAgentItems,
    agentBodyUnits,
    isExploring: explorationState.isExploring,
  });

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
    ...(!buckets.assistantItem && generatedImageGalleryBlock
      ? [generatedImageGalleryBlock]
      : []),
    ...(deferredAssistantActionsBlock ? [deferredAssistantActionsBlock] : []),
    ...buckets.postAssistantItems,
    ...buckets.mcpServerElicitationItems,
    ...(buckets.proposedPlanItem ? [buckets.proposedPlanItem] : []),
    ...(buckets.unifiedDiffItem ? [buckets.unifiedDiffItem] : []),
    ...buckets.remoteTaskCreatedItems,
    ...buckets.personalityChangedItems,
    ...buckets.forkedFromConversationItems,
  ].filter((block) => !turnOwnerHiddenBlockIds.has(block.id) && !assistantAfterBlockIds.has(block.id));
  const resolvedBlocks = flattenBlocks(leadingBlocks, agentBodyUnits, trailingBlocks);
  const hasFinalAssistantStarted = (
    buckets.assistantItem?.type === "assistantMessage"
    && buckets.assistantItem.entry.assistantPhase === "final_answer"
    && hasRenderableAssistantContent(buckets.assistantItem)
  ) || (!input.isStreamingTurn && subagentActivityState.hasActivity);
  const hasRenderableAgentBodyUnits = hasFinalAssistantStarted
    && !isCancelledTurn
    && (agentBodyUnits.length > 0 || subagentActivityState.hasActivity);

  return {
    turnId: input.turnId,
    turnKey,
    turn: input.turn,
    buckets,
    agentActivitySourceItems: visibleAgentItems,
    leadingBlocks,
    agentBodyUnits,
    trailingBlocks,
    blocks: resolvedBlocks,
    aboveComposerBlocks,
    workedForItem,
    workedForTiming,
    workedDurationMs,
    isLatestTurn: input.isLatestTurn,
    isStreamingTurn: input.isStreamingTurn,
    isBlocked: input.isBlocked,
    liveActivity,
    searchableText: collectSearchableText(resolvedBlocks),
    searchUnits,
    hasRenderableAgentBodyUnits,
    defaultAgentBodyCollapsed:
      hasRenderableAgentBodyUnits && !subagentActivityState.hasActiveActivity,
    collapsedMessageCount: agentBodyUnits.length,
  };
}
