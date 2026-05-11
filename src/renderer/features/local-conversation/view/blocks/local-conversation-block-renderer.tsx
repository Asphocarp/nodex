import {
  ThreadAutomaticApprovalReviewBlock,
  ThreadCollapsedToolActivityBlock,
  ThreadMultiAgentGroupBlock,
  ThreadMultiAgentActionBlock,
  ThreadAssistantBodyBlock,
  ThreadContextCompactionBlock,
  ThreadExplorationGroupBlock,
  ThreadHookBlock,
  ThreadMcpServerElicitationBlock,
  ThreadPlanCardBlock,
  ThreadPlanImplementationBlock,
  ThreadReasoningBlock,
  ThreadStreamErrorBlock,
  ThreadSystemErrorBlock,
  ThreadThinkingPlaceholderBlock,
  ThreadSystemBannerBlock,
  ThreadTurnDiffBlock,
  ThreadUserAttachmentStripBlock,
  ThreadToolSurfaceBlock,
  ThreadUserInputResponseCard,
  ThreadUserBubbleBlock,
} from "./local-conversation-block-leaves";
import type { CodexTurnDiffReviewTarget } from "../../../../lib/types";
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
  onOpenTurnDiffReview?: (target: CodexTurnDiffReviewTarget) => void;
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
  onOpenTurnDiffReview,
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

  if (block.type === "collapsedToolActivity") {
    return (
      <ThreadCollapsedToolActivityBlock
        block={block}
        isLatestTurn={isLatestTurn}
        isStreamingTurn={isStreamingTurn}
        projectWorkspacePath={projectWorkspacePath}
        threadCwd={threadCwd}
        onOpenTurnDiffReview={onOpenTurnDiffReview}
      />
    );
  }

  if (block.type === "thinkingPlaceholder") {
    return <ThreadThinkingPlaceholderBlock block={block} isLatestTurn={isLatestTurn} isStreamingTurn={isStreamingTurn} />;
  }

  if (block.type === "userAttachmentStrip") {
    return <ThreadUserAttachmentStripBlock block={block} isLatestTurn={isLatestTurn} isStreamingTurn={isStreamingTurn} />;
  }

  if (
    block.type === "exec"
    || block.type === "fileChange"
    || block.type === "mcpToolCall"
    || block.type === "webSearch"
  ) {
    return (
      <ThreadToolSurfaceBlock
        block={block}
        isLatestTurn={isLatestTurn}
        isStreamingTurn={isStreamingTurn}
        projectWorkspacePath={projectWorkspacePath}
        threadCwd={threadCwd}
        onOpenTurnDiffReview={onOpenTurnDiffReview}
      />
    );
  }

  if (block.type === "automaticApprovalReview") {
    return <ThreadAutomaticApprovalReviewBlock block={block} isLatestTurn={isLatestTurn} isStreamingTurn={isStreamingTurn} />;
  }

  if (block.type === "multiAgentAction") {
    return <ThreadMultiAgentActionBlock block={block} isLatestTurn={isLatestTurn} isStreamingTurn={isStreamingTurn} />;
  }

  if (block.type === "turnDiff") {
    return (
      <ThreadTurnDiffBlock
        block={block}
        isLatestTurn={isLatestTurn}
        isStreamingTurn={isStreamingTurn}
        projectWorkspacePath={projectWorkspacePath}
        threadCwd={threadCwd}
        onOpenTurnDiffReview={onOpenTurnDiffReview}
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
        onForkFromTurn={onForkFromTurn}
      />
    );
  }

  if (block.type === "userInputResponse") {
    return <ThreadUserInputResponseCard block={block} isLatestTurn={isLatestTurn} isStreamingTurn={isStreamingTurn} />;
  }

  if (block.type === "mcpServerElicitation") {
    return <ThreadMcpServerElicitationBlock block={block} isLatestTurn={isLatestTurn} isStreamingTurn={isStreamingTurn} />;
  }

  if (block.type === "hook") {
    return <ThreadHookBlock block={block} isLatestTurn={isLatestTurn} isStreamingTurn={isStreamingTurn} />;
  }

  if (block.type === "planImplementation") {
    return <ThreadPlanImplementationBlock block={block} isLatestTurn={isLatestTurn} isStreamingTurn={isStreamingTurn} />;
  }

  if (block.type === "contextCompaction") {
    return <ThreadContextCompactionBlock block={block} isLatestTurn={isLatestTurn} isStreamingTurn={isStreamingTurn} />;
  }

  if (block.type === "streamError") {
    return <ThreadStreamErrorBlock block={block} isLatestTurn={isLatestTurn} isStreamingTurn={isStreamingTurn} />;
  }

  if (block.type === "systemError") {
    return <ThreadSystemErrorBlock block={block} isLatestTurn={isLatestTurn} isStreamingTurn={isStreamingTurn} />;
  }

  return (
    <ThreadSystemBannerBlock
      block={block}
      isLatestTurn={isLatestTurn}
      isStreamingTurn={isStreamingTurn}
    />
  );
}
