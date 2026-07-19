import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, type ComponentProps } from "react";
import type { CodexConversationSnapshot, CodexReviewDiffCommentAttachment } from "@/lib/types";
import {
  addReviewDiffCommentAttachment,
  clearReviewDiffCommentAttachments,
} from "@/lib/review-diff-comment-attachment-store";
import { buildReviewFileSafety } from "../../../shared/review-file-safety";
import { ReviewDiffPanel } from "./review-diff-panel";
import { buildReviewConversationProjection } from "@/features/review/model/review-conversation-projection";

function buildStoryConversation(): CodexConversationSnapshot {
  return {
    threadId: "thr_story_review",
    projectId: "default",
    source: null,
    threadName: "Review thread",
    threadPreview: "Inspect the latest turn diff",
    modelProvider: "codex",
    cwd: "/Users/asc/repo/nodex",
    statusType: "idle",
    statusActiveFlags: [],
    archived: false,
    createdAt: 1,
    updatedAt: 2,
    linkedAt: "2026-03-01T00:00:00.000Z",
    resumeState: "resumed",
    turns: [
      {
        threadId: "thr_story_review",
        turnId: "turn_1",
        status: "completed",
        diff: [
          "diff --git a/src/renderer/components/workbench/workbench-shell.tsx b/src/renderer/components/workbench/workbench-shell.tsx",
          "index 1111111..2222222 100644",
          "--- a/src/renderer/components/workbench/workbench-shell.tsx",
          "+++ b/src/renderer/components/workbench/workbench-shell.tsx",
          "@@ -1768,6 +1768,10 @@",
          "       title: \"Diffs\",",
          "       icon: STAGE_ICONS.files,",
          "       hideHeader: true,",
          "-      content: <StageFilesPlaceholder />,",
          "+      content: (",
          "+        <ReviewDiffPanel conversation={activeThreadConversation} />",
          "+      ),",
          "     },",
          "",
          "diff --git a/src/renderer/components/workbench/review-diff-panel.tsx b/src/renderer/components/workbench/review-diff-panel.tsx",
          "new file mode 100644",
          "--- /dev/null",
          "+++ b/src/renderer/components/workbench/review-diff-panel.tsx",
          "@@ -0,0 +1,4 @@",
          "+export function ReviewDiffPanel() {",
          "+  return null;",
          "+}",
          "+",
          "",
        ].join("\n"),
        itemIds: [],
        items: [],
      },
    ],
    requests: [],
    queuedFollowUps: [],
    pendingSteers: [],
    backgroundTerminalRows: [],
    childMemberships: [],
    capabilityFlags: {
      canEditLastUserTurn: true,
      canForkFromTurn: true,
      canSearch: true,
      canCollapseTurns: true,
    },
  };
}

function buildCommentStoryConversation(): CodexConversationSnapshot {
  const conversation = buildStoryConversation();
  conversation.turns[0]!.items = [
    {
      threadId: "thr_story_review",
      turnId: "turn_1",
      itemId: "item_review_comment",
      type: "message",
      kind: "assistantMessage",
      role: "assistant",
      markdownText: '::code-comment{title="Tighten guard" body="This branch should return early before the expensive path." file="src/renderer/components/workbench/workbench-shell.tsx" start=1768 end=1768 priority=1}',
      createdAt: 1,
      updatedAt: 1,
    },
  ];
  return conversation;
}

function buildReviewParityConversation(): CodexConversationSnapshot {
  const conversation = buildStoryConversation();
  conversation.threadId = "thr_story_review_parity";
  conversation.turns[0] = {
    ...conversation.turns[0]!,
    threadId: "thr_story_review_parity",
    turnId: "turn_review_parity",
    diff: [
      "diff --git a/src/renderer/components/workbench/review-pane.tsx b/src/renderer/components/workbench/review-pane.tsx",
      "index 1111111..2222222 100644",
      "--- a/src/renderer/components/workbench/review-pane.tsx",
      "+++ b/src/renderer/components/workbench/review-pane.tsx",
      "@@ -1,4 +1,5 @@",
      " import { useMemo } from \"react\";",
      " type Props = { open: boolean };",
      " export function ReviewPane(props: Props) {",
      "+  const active = props.open;",
      "   return null;",
      "@@ -120,4 +121,5 @@",
      " function renderFooter() {",
      "   const label = \"Review\";",
      "+  const action = \"Inspect\";",
      "   return label;",
      " }",
      "",
      "diff --git a/src/renderer/lib/review-model.ts b/src/renderer/lib/review-model.ts",
      "index 1111111..2222222 100644",
      "--- a/src/renderer/lib/review-model.ts",
      "+++ b/src/renderer/lib/review-model.ts",
      "@@ -12,4 +12,5 @@",
      " export type ReviewModel = {",
      "   path: string;",
      "+  iconToken: string;",
      " };",
      "@@ -80,5 +81,6 @@",
      " export function buildModel() {",
      "   return {",
      "+    iconToken: \"typescript\",",
      "     path: \"src/renderer/lib/review-model.ts\",",
      "   };",
      " }",
      "",
      "diff --git a/docs/FRONTEND.md b/docs/FRONTEND.md",
      "index 1111111..2222222 100644",
      "--- a/docs/FRONTEND.md",
      "+++ b/docs/FRONTEND.md",
      "@@ -1,4 +1,5 @@",
      " # Frontend",
      " Review tab surfaces are compact.",
      "+File rows use Codex file-type icons.",
      " ## Diff review",
      " Keep the diff readable.",
      "@@ -60,4 +61,5 @@",
      " ## Implementation notes",
      " Diff context should stay expandable.",
      "+Large unchanged ranges render line-info separators.",
      " Manual review covers visual parity.",
      " Tests cover behavior.",
      "",
    ].join("\n"),
  };
  return conversation;
}

function buildMetadataOnlyReviewConversation(input: {
  threadId: string;
  path: string;
  safety: ReturnType<typeof buildReviewFileSafety>;
}): CodexConversationSnapshot {
  const conversation = buildStoryConversation();
  conversation.threadId = input.threadId;
  conversation.turns[0] = {
    ...conversation.turns[0]!,
    threadId: input.threadId,
    turnId: "turn_metadata_only",
    diff: "",
    items: [{
      threadId: input.threadId,
      turnId: "turn_metadata_only",
      entryId: "turn-diff:turn_metadata_only",
      itemId: "turn-diff:turn_metadata_only",
      type: "turn_diff",
      kind: "systemEvent",
      semanticKind: "diff",
      status: "completed",
      source: "live",
      sequence: 0,
      rawItem: {
        type: "turn-diff",
        unifiedDiff: "",
        patchBatches: [{
          cwd: conversation.cwd,
          changes: [{
            path: input.path,
            type: "nonRenderable",
            originalType: "add",
            movePath: null,
            safety: input.safety,
          }],
        }],
      },
      createdAt: 1,
      updatedAt: 1,
    }],
  };
  return conversation;
}

type ReviewStorySurfaceProps = Omit<
  ComponentProps<typeof ReviewDiffPanel>,
  "conversationProjection"
> & {
  conversation?: CodexConversationSnapshot | null;
};

function ReviewStorySurface({
  openControlLabel,
  pendingCommentAttachments,
  conversation = null,
  ...args
}: ReviewStorySurfaceProps & {
  openControlLabel?: string;
  pendingCommentAttachments?: CodexReviewDiffCommentAttachment[];
}) {
  const conversationProjection = buildReviewConversationProjection(conversation);
  const storyThreadId =
    conversationProjection.threadId ?? args.threadId ?? null;

  useEffect(() => {
    if (!storyThreadId || !pendingCommentAttachments?.length) return;
    clearReviewDiffCommentAttachments(storyThreadId);
    for (const attachment of pendingCommentAttachments) {
      addReviewDiffCommentAttachment(storyThreadId, attachment);
    }
    return () => clearReviewDiffCommentAttachments(storyThreadId);
  }, [pendingCommentAttachments, storyThreadId]);

  useEffect(() => {
    if (!openControlLabel) return;
    const timerId = window.setTimeout(() => {
      const button = document.querySelector<HTMLButtonElement>(`button[aria-label="${openControlLabel}"]`);
      button?.click();
    }, 100);
    return () => window.clearTimeout(timerId);
  }, [openControlLabel]);

  return (
    <div className="h-screen overflow-hidden bg-token-main-surface-primary">
      <ReviewDiffPanel
        {...args}
        conversationProjection={conversationProjection}
      />
    </div>
  );
}

function buildStoryPendingComment(input: {
  id: string;
  path: string;
  side: "left" | "right";
  line: number;
  startLine?: number;
  startSide?: "left" | "right";
  text: string;
}): CodexReviewDiffCommentAttachment {
  return {
    id: input.id,
    type: "comment",
    content: [{
      content_type: "text",
      text: input.text,
    }],
    position: {
      side: input.side,
      path: input.path,
      line: input.line,
      ...(input.startLine ? { start_line: input.startLine } : {}),
      ...(input.startSide ? { start_side: input.startSide } : {}),
    },
    localDiffHunk: "@@ -1768,6 +1768,10 @@\n       title: \"Diffs\",\n+        <ReviewDiffPanel conversation={activeThreadConversation} />",
    source: {
      kind: "review-diff",
      label: "Comment on line R1771",
      sessionKey: "storybook",
    },
    createdAt: 1,
  };
}

const meta = {
  title: "Workbench/Review Diff Panel",
  component: ReviewStorySurface,
  args: {
    conversation: buildStoryConversation(),
    onStartThreadPrompt: async () => undefined,
    projectWorkspacePath: "/Users/asc/repo/nodex",
  },
  render: (args) => <ReviewStorySurface {...args} />,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof ReviewStorySurface>;

export default meta;

type Story = StoryObj<typeof meta>;

export const LastTurnWithoutFileTree: Story = {};

export const HeaderAndFileRows: Story = {
  args: {
    conversation: buildStoryConversation(),
    projectWorkspacePath: "/Users/asc/repo/nodex",
  },
};

export const LastTurnWithFileTree: Story = {
  args: {
    initialFileTreeOpen: true,
  },
};

export const CodexParityLineInfoAndIcons: Story = {
  args: {
    conversation: buildReviewParityConversation(),
    initialFileTreeOpen: true,
    projectWorkspacePath: "/Users/asc/repo/nodex",
  },
  parameters: {
    docs: {
      description: {
        story: "Review diff parity fixture: line-info unchanged-range separators, compact file rows, and file-type icons should be visible together.",
      },
    },
  },
};

export const BinaryPlaceholder: Story = {
  args: {
    conversation: buildMetadataOnlyReviewConversation({
      threadId: "thr_story_review_binary",
      path: "assets/logo.png",
      safety: buildReviewFileSafety({
        binary: true,
        sizeBytes: 2_048,
        mimeType: "image/png",
      }),
    }),
    projectWorkspacePath: "/Users/asc/repo/nodex",
    initialFileTreeOpen: true,
  },
};

export const TooLargePlaceholder: Story = {
  args: {
    conversation: buildMetadataOnlyReviewConversation({
      threadId: "thr_story_review_large",
      path: "logs/debug.txt",
      safety: buildReviewFileSafety({
        tooLarge: true,
        sizeBytes: 1_048_577,
        mimeType: "text/plain",
      }),
    }),
    projectWorkspacePath: "/Users/asc/repo/nodex",
    initialFileTreeOpen: true,
  },
};

export const FileTreeChrome: Story = {
  args: {
    initialSource: "unstaged",
    initialFileTreeOpen: true,
    projectWorkspacePath: "/tmp/storybook/virtualized-tree",
  },
};

export const NoDiff: Story = {
  args: {
    initialSource: "unstaged",
    projectWorkspacePath: "/tmp/storybook/no-diff",
  },
};

export const BranchReview: Story = {
  args: {
    initialSource: "branch",
    initialFileTreeOpen: true,
    projectWorkspacePath: "/Users/asc/repo/nodex",
  },
};

export const NoGitRepository: Story = {
  args: {
    initialSource: "unstaged",
    projectWorkspacePath: "/tmp/storybook/no-git",
  },
};

export const LargeDiffCappedMode: Story = {
  args: {
    initialSource: "unstaged",
    initialFileTreeOpen: true,
    projectWorkspacePath: "/tmp/storybook/large-diff",
  },
};

export const LargeDiffCappedModeCollapsed: Story = {
  args: {
    initialSource: "unstaged",
    projectWorkspacePath: "/tmp/storybook/large-diff",
  },
};

export const VirtualizedFileTree: Story = {
  args: {
    initialSource: "unstaged",
    initialFileTreeOpen: true,
    projectWorkspacePath: "/tmp/storybook/virtualized-tree",
  },
};

export const NestedFileTree: Story = {
  args: {
    initialSource: "unstaged",
    initialFileTreeOpen: true,
    projectWorkspacePath: "/tmp/storybook/virtualized-tree",
  },
};

export const TreeStatusAndSelection: Story = {
  args: {
    initialSource: "unstaged",
    initialFileTreeOpen: true,
    projectWorkspacePath: "/tmp/storybook/virtualized-tree",
  },
};

export const StagedEmpty: Story = {
  args: {
    initialSource: "staged",
    projectWorkspacePath: "/tmp/storybook/staged-empty",
  },
};

export const UnstagedChanges: Story = {
  args: {
    initialSource: "unstaged",
    projectWorkspacePath: "/Users/asc/repo/nodex",
  },
};

export const OptionsMenuOpen: Story = {
  args: {
    initialSource: "unstaged",
    projectWorkspacePath: "/Users/asc/repo/nodex",
  },
  render: (args) => <ReviewStorySurface {...args} openControlLabel="Review options" />,
  parameters: {
    docs: {
      description: {
        story: "The default full-file loading state is on, so the open menu should offer `Don't load full files`.",
      },
    },
  },
};

export const JumpToFileOpen: Story = {
  args: {
    initialSource: "unstaged",
    initialFileTreeOpen: true,
    projectWorkspacePath: "/tmp/storybook/virtualized-tree",
  },
  render: (args) => <ReviewStorySurface {...args} openControlLabel="Jump to file" />,
};

export const InlineComment: Story = {
  args: {
    conversation: buildCommentStoryConversation(),
    projectWorkspacePath: "/Users/asc/repo/nodex",
  },
};

export const PendingLocalComment: Story = {
  args: {
    conversation: buildStoryConversation(),
    projectWorkspacePath: "/Users/asc/repo/nodex",
  },
  render: (args) => (
    <ReviewStorySurface
      {...args}
      pendingCommentAttachments={[
        buildStoryPendingComment({
          id: "story_local_comment",
          path: "src/renderer/components/workbench/workbench-shell.tsx",
          side: "right",
          line: 1771,
          text: "Request this change before the next turn.",
        }),
      ]}
    />
  ),
};

export const RangeLocalComment: Story = {
  args: {
    conversation: buildStoryConversation(),
    projectWorkspacePath: "/Users/asc/repo/nodex",
  },
  render: (args) => (
    <ReviewStorySurface
      {...args}
      pendingCommentAttachments={[
        buildStoryPendingComment({
          id: "story_range_comment",
          path: "src/renderer/components/workbench/workbench-shell.tsx",
          side: "right",
          line: 1771,
          startLine: 1769,
          startSide: "left",
          text: "Keep this range aligned with the removed placeholder path.",
        }),
      ]}
    />
  ),
};

export const LiveTrackedThenComplete: Story = {
  args: {
    initialSource: "unstaged",
    initialFileTreeOpen: true,
    projectWorkspacePath: "/Users/asc/repo/nodex",
  },
  parameters: {
    docs: {
      description: {
        story: "The live summary may publish tracked files first and then atomically add untracked files without resetting already loaded rows.",
      },
    },
  },
};

export const AgentStreamingIsolation: Story = {
  args: {
    conversation: buildReviewParityConversation(),
    projectWorkspacePath: "/Users/asc/repo/nodex",
  },
  parameters: {
    docs: {
      description: {
        story: "Use this fixture while streaming assistant prose: the Review projection and file rows remain stable until a turn-diff item changes.",
      },
    },
  },
};

export const ViewportGatedFullContent: Story = {
  args: {
    initialSource: "unstaged",
    initialFileTreeOpen: true,
    projectWorkspacePath: "/tmp/storybook/virtualized-tree",
  },
  parameters: {
    docs: {
      description: {
        story: "A many-file partial review for checking that only expanded rows inside the virtualizer margin request full content.",
      },
    },
  },
};

export const FullContentFallbackStates: Story = {
  args: {
    conversation: buildReviewParityConversation(),
    projectWorkspacePath: "/tmp/storybook/full-content-fallback",
  },
  parameters: {
    docs: {
      description: {
        story: "Inspect `data-review-full-content-state` while exercising loading, success, unavailable, and failed reads; every terminal fallback keeps the partial diff visible.",
      },
    },
  },
};

export const StaleSnapshotRecovery: Story = {
  args: {
    initialSource: "unstaged",
    projectWorkspacePath: "/tmp/storybook/stale-snapshot",
  },
  parameters: {
    docs: {
      description: {
        story: "A generation-refresh fixture: stale diff, full-content, and search responses must be discarded while the last consistent rows remain visible.",
      },
    },
  },
};

export const GeneratedAttributesServerSearch: Story = {
  args: {
    initialSource: "unstaged",
    initialFileTreeOpen: true,
    projectWorkspacePath: "/tmp/storybook/generated-attributes",
  },
  parameters: {
    docs: {
      description: {
        story: "Generated classification is intentionally unresolved in this fixture, forcing content search through the generation-bound server path.",
      },
    },
  },
};
