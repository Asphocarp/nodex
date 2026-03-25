import {
  ThreadMultiAgentGroupBlock,
  ThreadAnsweredUserInputCard,
  ThreadAssistantBodyBlock,
  ThreadExplorationGroupBlock,
  ThreadPlanCardBlock,
  ThreadReasoningBlock,
  ThreadThinkingPlaceholderBlock,
  ThreadSystemBannerBlock,
  ThreadTurnDiffBlock,
  ThreadToolSurfaceBlock,
  ThreadUserBubbleBlock,
  ThreadWorkedForBlock,
} from "./local-conversation-block-leaves";
import type { ThreadBlockModel } from "../../thread-stage-types";

interface ThreadBlockRendererProps {
  block: ThreadBlockModel;
  isLatestTurn: boolean;
  isStreamingTurn: boolean;
  isSearchMatch?: boolean;
  isActiveSearchMatch?: boolean;
  projectWorkspacePath?: string | null;
  threadCwd?: string | null;
  onEditLastUserTurn?: (input: { threadId: string; turnId: string; message: string }) => void | Promise<void>;
  onForkFromTurn?: (input: { threadId: string; turnId: string; message: string; isLatestTurn: boolean }) => void | Promise<void>;
}

export function ThreadBlockRenderer({
  block,
  isLatestTurn,
  isStreamingTurn,
  isSearchMatch = false,
  isActiveSearchMatch = false,
  projectWorkspacePath,
  threadCwd,
  onEditLastUserTurn,
  onForkFromTurn,
}: ThreadBlockRendererProps) {
  if (block.type === "explorationGroup") {
    return (
      <ThreadExplorationGroupBlock
        block={block}
        isLatestTurn={isLatestTurn}
        isStreamingTurn={isStreamingTurn}
        projectWorkspacePath={projectWorkspacePath}
        threadCwd={threadCwd}
      />
    );
  }

  if (block.type === "multiAgentGroup") {
    return (
      <ThreadMultiAgentGroupBlock
        block={block}
        isLatestTurn={isLatestTurn}
        isStreamingTurn={isStreamingTurn}
        projectWorkspacePath={projectWorkspacePath}
        threadCwd={threadCwd}
      />
    );
  }

  if (block.type === "thinkingPlaceholder") {
    return <ThreadThinkingPlaceholderBlock block={block} isLatestTurn={isLatestTurn} isStreamingTurn={isStreamingTurn} />;
  }

  if (
    block.type === "exec"
    || block.type === "patch"
    || block.type === "fileChange"
    || block.type === "toolCall"
    || block.type === "mcpToolCall"
    || block.type === "webSearch"
    || block.type === "automaticApprovalReview"
    || block.type === "multiAgentAction"
  ) {
    return (
      <ThreadToolSurfaceBlock
        block={block}
        isLatestTurn={isLatestTurn}
        isStreamingTurn={isStreamingTurn}
        projectWorkspacePath={projectWorkspacePath}
        threadCwd={threadCwd}
      />
    );
  }

  if (block.type === "turnDiff") {
    return (
      <ThreadTurnDiffBlock
        block={block}
        isLatestTurn={isLatestTurn}
        isStreamingTurn={isStreamingTurn}
        projectWorkspacePath={projectWorkspacePath}
        threadCwd={threadCwd}
      />
    );
  }

  if (block.type === "workedFor") {
    return (
      <ThreadWorkedForBlock
        block={block}
        isLatestTurn={isLatestTurn}
        isStreamingTurn={isStreamingTurn}
        projectWorkspacePath={projectWorkspacePath}
        threadCwd={threadCwd}
      />
    );
  }

  if (block.type === "userMessage") {
    return (
      <ThreadUserBubbleBlock
        block={block}
        isLatestTurn={isLatestTurn}
        isStreamingTurn={isStreamingTurn}
        isSearchMatch={isSearchMatch}
        isActiveSearchMatch={isActiveSearchMatch}
        onEditLastUserTurn={onEditLastUserTurn}
        onForkFromTurn={onForkFromTurn}
      />
    );
  }

  if (block.type === "reasoning") {
    return (
      <ThreadReasoningBlock
        block={block}
        isLatestTurn={isLatestTurn}
        isStreamingTurn={isStreamingTurn}
      />
    );
  }

  if (block.type === "proposedPlan" || block.type === "todoList") {
    return (
      <ThreadPlanCardBlock
        block={block}
        isLatestTurn={isLatestTurn}
        isStreamingTurn={isStreamingTurn}
      />
    );
  }

  if (block.type === "assistantMessage") {
    return (
      <ThreadAssistantBodyBlock
        block={block}
        isLatestTurn={isLatestTurn}
        isStreamingTurn={isStreamingTurn}
        isSearchMatch={isSearchMatch}
        isActiveSearchMatch={isActiveSearchMatch}
      />
    );
  }

  if (block.type === "answeredUserInput") {
    return <ThreadAnsweredUserInputCard block={block} isLatestTurn={isLatestTurn} isStreamingTurn={isStreamingTurn} />;
  }

  return (
    <ThreadSystemBannerBlock
      block={block}
      isLatestTurn={isLatestTurn}
      isStreamingTurn={isStreamingTurn}
    />
  );
}
