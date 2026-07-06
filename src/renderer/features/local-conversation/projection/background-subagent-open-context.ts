import type {
  ThreadComposerShellBackgroundAgentRowModel,
  ThreadOpenThreadContext,
} from "../thread-stage-types";

export function buildBackgroundAgentOpenContext(
  row: ThreadComposerShellBackgroundAgentRowModel,
): ThreadOpenThreadContext {
  return {
    subagent: {
      agentRole: row.agentRole,
      conversationId: row.conversationId,
      diffStats: row.diffStats,
      displayName: row.displayName,
      showInlineActivity: row.showInlineActivity,
      spawnModel: row.spawnModel,
      status: row.status,
      statusSummary: row.statusSummary,
    },
  };
}
