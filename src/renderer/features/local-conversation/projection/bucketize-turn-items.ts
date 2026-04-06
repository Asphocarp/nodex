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
    preUserItems: [],
    userItems: [],
    assistantItem: null,
    systemEventItem: null,
    approvalItem: null,
    userInputItem: null,
    mcpServerElicitationItems: [],
    todoListItem: null,
    unifiedDiffItem: null,
    proposedPlanItem: null,
    planImplementationItem: null,
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

function isPendingApproval(item: ThreadTranscriptBlockModel): boolean {
  return item.type === "fileChange"
    ? item.entry.approvalRequestId != null && item.entry.fileChange == null
    : item.type === "exec"
      ? item.entry.approvalRequestId != null && item.entry.exitCode == null
      : false;
}

function hasRenderableAssistantContent(item: ThreadTranscriptBlockModel | null): boolean {
  if (!item || item.type !== "assistantMessage") return false;
  return (item.entry.markdownText?.trim().length ?? 0) > 0;
}

function isTrailingAutomaticApprovalReview(item: ThreadTranscriptBlockModel): boolean {
  return item.type === "automaticApprovalReview";
}

function isRenderableAgentItem(item: ThreadTranscriptBlockModel): boolean {
  switch (item.type) {
    case "assistantMessage":
    case "exec":
    case "fileChange":
    case "mcpToolCall":
    case "automaticApprovalReview":
    case "multiAgentAction":
    case "streamError":
    case "systemError":
    case "contextCompaction":
    case "reasoning":
    case "userInputResponse":
    case "workedFor":
    case "mcpServerElicitation":
      return true;
    case "webSearch":
      return item.searchableText.trim().length > 0;
    default:
      return false;
  }
}

function shouldPushHookToAgentItems(
  items: ThreadRendererItemModel[],
  currentIndex: number,
): boolean {
  return items.slice(currentIndex + 1).some((candidate) => {
    if (isPendingRequestItem(candidate)) {
      return candidate.type === "approval" || candidate.type === "userInput";
    }

    return candidate.type === "userMessage" || isRenderableAgentItem(candidate);
  });
}

export function bucketizeTurnItems(input: BucketizeTurnItemsInput): ThreadTurnRenderBuckets {
  const buckets = createEmptyBuckets();
  const genericItems: ThreadTranscriptBlockModel[] = [];
  let beforeAgentSequence = true;

  for (const [index, item] of input.items.entries()) {
    if (isPendingRequestItem(item)) {
      if (item.type === "approval") {
        buckets.approvalItem = item;
        continue;
      }

      if (item.type === "userInput") {
        buckets.userInputItem = item;
      }
      continue;
    }

    if (beforeAgentSequence && item.type === "userMessage") {
      buckets.userItems.push(item);
      continue;
    }

    if (beforeAgentSequence && item.type === "hook") {
      buckets.preUserItems.push(item);
      continue;
    }

    beforeAgentSequence = false;

    if (item.type === "turnDiff") {
      buckets.unifiedDiffItem = item;
      continue;
    }

    if (item.type === "todoList") {
      buckets.todoListItem = item;
      continue;
    }

    if (item.type === "proposedPlan") {
      buckets.proposedPlanItem = item;
      continue;
    }

    if (item.type === "planImplementation") {
      buckets.planImplementationItem = item;
      continue;
    }

    if (item.type === "remoteTaskCreated") {
      buckets.remoteTaskCreatedItems.push(item);
      continue;
    }

    if (item.type === "personalityChanged") {
      buckets.personalityChangedItems.push(item);
      continue;
    }

    if (item.type === "forkedFromConversation") {
      buckets.forkedFromConversationItems.push(item);
      continue;
    }

    if (item.type === "modelChanged") {
      buckets.modelChangedItems.push(item);
      continue;
    }

    if (item.type === "modelRerouted") {
      buckets.modelReroutedItems.push(item);
      continue;
    }

    if (item.type === "mcpServerElicitation" && item.status !== "completed") {
      buckets.mcpServerElicitationItems.push(item);
      continue;
    }

    if (isPendingApproval(item)) {
      continue;
    }

    if (item.type === "hook") {
      if (shouldPushHookToAgentItems(input.items, index)) {
        genericItems.push(item);
      } else {
        buckets.postAssistantItems.push(item);
      }
      continue;
    }

    if (item.type === "userMessage") {
      genericItems.push(item);
      continue;
    }

    if (isRenderableAgentItem(item)) {
      genericItems.push(item);
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
    buckets.postAssistantItems.unshift(...trailingReviews);
  } else {
    genericItems.push(...trailingReviews);
  }

  const trailingSystemCandidate = genericItems[genericItems.length - 1] ?? null;
  const canPromoteSystemError =
    input.turnStatus !== "inProgress"
    && !hasRenderableAssistantContent(buckets.assistantItem)
    && trailingSystemCandidate?.type === "systemError";

  if (canPromoteSystemError && trailingSystemCandidate) {
    buckets.systemEventItem = trailingSystemCandidate;
    genericItems.pop();
  }

  buckets.agentItems.push(...genericItems);
  return buckets;
}
