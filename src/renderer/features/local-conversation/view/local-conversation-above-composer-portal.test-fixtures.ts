import type { CodexConversationItem } from "../../../lib/types";
import type { ThreadTranscriptBlockModel } from "../thread-stage-types";

export function buildAboveComposerTurnDiffBlock({
  additions = 1,
  deletions = 1,
}: {
  additions?: number;
  deletions?: number;
} = {}): ThreadTranscriptBlockModel {
  const entry: CodexConversationItem = {
    threadId: "thread-portal",
    turnId: "turn-1",
    itemId: "turn-diff-live",
    entryId: "turn-diff-live",
    type: "turn_diff",
    kind: "systemEvent",
    semanticKind: "diff",
    status: "inProgress",
    rawItem: {
      type: "turn-diff",
      cwd: "/tmp/project",
      unifiedDiff: [
        "--- a/src/app.ts",
        "+++ b/src/app.ts",
        `@@ -1,${deletions} +1,${additions} @@`,
        ...Array.from({ length: deletions }, (_, index) => `-old line ${index}`),
        ...Array.from({ length: additions }, (_, index) => `+new line ${index}`),
      ].join("\n"),
    },
    createdAt: 1,
    updatedAt: 2,
  };

  return {
    id: "turn-diff-live",
    turnId: "turn-1",
    createdAt: 1,
    updatedAt: 2,
    searchableText: "1 file changed",
    type: "turnDiff",
    entry,
  };
}

export function buildAboveComposerTodoListBlock(): ThreadTranscriptBlockModel {
  const entry: CodexConversationItem = {
    threadId: "thread-portal",
    turnId: "turn-1",
    itemId: "todo-live",
    entryId: "todo-live",
    type: "plan",
    kind: "plan",
    semanticKind: "todoList",
    status: "inProgress",
    markdownText: ["1. Inspect the portal", "2. Patch the fixed shell", "3. Verify tests"].join(
      "\n",
    ),
    rawItem: {
      plan: [
        { step: "Inspect the portal", status: "completed" },
        { step: "Patch the fixed shell", status: "in_progress" },
        { step: "Verify tests", status: "pending" },
      ],
    },
    createdAt: 1,
    updatedAt: 2,
  };

  return {
    id: "todo-live",
    turnId: "turn-1",
    createdAt: 1,
    updatedAt: 2,
    searchableText: "todo",
    type: "todoList",
    entry,
  };
}
