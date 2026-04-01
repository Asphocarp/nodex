import type {
  ThreadPendingTurnRequestModel,
  ThreadRendererItemModel,
  ThreadTranscriptBlockModel,
  ThreadTurnRenderBuckets,
} from "../thread-stage-types";

interface BucketizeTurnItemsInput {
  items: ThreadRendererItemModel[];
  turnStatus?: "inProgress" | "completed" | "interrupted" | "failed";
}

function createEmptyBuckets(): ThreadTurnRenderBuckets {
  return {
    userItems: [],
    assistantItem: null,
    systemEventItem: null,
    approvalItems: [],
    userInputItems: [],
    implementPlanItem: null,
    mcpServerElicitationItems: [],
    todoListItem: null,
    unifiedDiffItem: null,
    proposedPlanItem: null,
    postAssistantItems: [],
    agentItems: [],
    remoteTaskCreatedItems: [],
    personalityChangedItems: [],
    forkedFromConversationItems: [],
    modelChangedItems: [],
    modelReroutedItems: [],
    thinkingPlaceholderItem: null,
  };
}

function isPendingRequestItem(item: ThreadRendererItemModel): item is ThreadPendingTurnRequestModel {
  return item.type === "approval" || item.type === "userInput" || item.type === "implementPlan";
}

function isSystemLikeItem(item: ThreadTranscriptBlockModel): boolean {
  return item.type === "systemError"
    || item.type === "streamError"
    || item.type === "contextCompaction"
    || item.type === "systemEvent";
}

function isTrailingAutomaticApprovalReview(item: ThreadTranscriptBlockModel): boolean {
  return item.type === "automaticApprovalReview";
}

function hasRenderableAssistantContent(item: ThreadTranscriptBlockModel | null): boolean {
  if (!item || item.type !== "assistantMessage") return false;
  return (item.entry.markdownText?.trim().length ?? 0) > 0;
}

function isCodexAgentItem(item: ThreadTranscriptBlockModel): boolean {
  switch (item.type) {
    case "assistantMessage":
    case "exec":
    case "fileChange":
    case "mcpToolCall":
    case "automaticApprovalReview":
    case "multiAgentAction":
    case "streamError":
    case "systemError":
    case "reasoning":
    case "answeredUserInput":
    case "workedFor":
      return true;
    case "webSearch":
      return item.searchableText.trim().length > 0;
    default:
      return false;
  }
}

export function bucketizeTurnItems(input: BucketizeTurnItemsInput): ThreadTurnRenderBuckets {
  const buckets = createEmptyBuckets();
  const genericItems: ThreadTranscriptBlockModel[] = [];
  let leadingUserPrefixOpen = true;

  for (const item of input.items) {
    if (isPendingRequestItem(item)) {
      if (item.type === "approval") {
        buckets.approvalItems.push(item);
        continue;
      }

      if (item.type === "userInput") {
        buckets.userInputItems.push(item);
        continue;
      }

      if (buckets.implementPlanItem === null) {
        buckets.implementPlanItem = item;
      }
      continue;
    }

    switch (item.type) {
      case "modelChanged":
        buckets.modelChangedItems.push(item);
        continue;
      case "modelRerouted":
        buckets.modelReroutedItems.push(item);
        continue;
      case "remoteTaskCreated":
        buckets.remoteTaskCreatedItems.push(item);
        continue;
      case "personalityChanged":
        buckets.personalityChangedItems.push(item);
        continue;
      case "forkedFromConversation":
        buckets.forkedFromConversationItems.push(item);
        continue;
    }

    if (item.type === "userMessage" && leadingUserPrefixOpen) {
      buckets.userItems.push(item);
      continue;
    }

    leadingUserPrefixOpen = false;

    if (item.type === "turnDiff") {
      buckets.unifiedDiffItem = item;
    }

    if (item.type === "todoList") {
      buckets.todoListItem = item;
    }

    if (item.type === "mcpServerElicitation" && item.status !== "completed") {
      buckets.mcpServerElicitationItems.push(item);
      continue;
    }

    if (item.type === "proposedPlan") {
      buckets.proposedPlanItem = item;
      continue;
    }

    if (item.type === "contextCompaction") {
      buckets.postAssistantItems.push(item);
      continue;
    }

    if (item.type === "answeredUserInput") {
      genericItems.push(item);
      continue;
    }

    if (item.type === "userMessage") {
      genericItems.push(item);
      continue;
    }

    if (isCodexAgentItem(item)) {
      genericItems.push(item);
      continue;
    }
  }

  const trailingReviews: ThreadTranscriptBlockModel[] = [];
  while (genericItems.length > 0 && isTrailingAutomaticApprovalReview(genericItems[genericItems.length - 1]!)) {
    const review = genericItems.pop();
    if (!review) break;
    trailingReviews.unshift(review);
  }

  const lastGenericItem = genericItems[genericItems.length - 1] ?? null;
  buckets.assistantItem = lastGenericItem?.type === "assistantMessage" ? lastGenericItem : null;
  if (buckets.assistantItem) {
    genericItems.pop();
    buckets.postAssistantItems.push(...trailingReviews);
  } else {
    genericItems.push(...trailingReviews);
  }

  const trailingSystemCandidate = genericItems[genericItems.length - 1] ?? null;
  const canPromoteSystemEvent =
    input.turnStatus !== "inProgress"
    && !hasRenderableAssistantContent(buckets.assistantItem)
    && trailingSystemCandidate?.type === "systemError";
  if (canPromoteSystemEvent && trailingSystemCandidate) {
    buckets.systemEventItem = trailingSystemCandidate;
    genericItems.pop();
  }

  for (const item of genericItems) {
    if (!item) continue;
    if (isSystemLikeItem(item) && buckets.systemEventItem === null && item.type === "systemEvent") {
      buckets.systemEventItem = item;
      continue;
    }

    buckets.agentItems.push(item);
  }

  return buckets;
}
