import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, type ComponentProps } from "react";
import type { CodexConversationSnapshot } from "@/lib/types";
import { ReviewDiffPanel } from "./review-diff-panel";

function buildStoryConversation(): CodexConversationSnapshot {
  return {
    threadId: "thr_story_review",
    projectId: "default",
    cardId: "card-1",
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

function ReviewStorySurface({
  openControlLabel,
  ...args
}: ComponentProps<typeof ReviewDiffPanel> & { openControlLabel?: string }) {
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
      <ReviewDiffPanel {...args} />
    </div>
  );
}

const meta = {
  title: "Workbench/Review Diff Panel",
  component: ReviewDiffPanel,
  args: {
    conversation: buildStoryConversation(),
    projectWorkspacePath: "/Users/asc/repo/nodex",
  },
  render: (args) => <ReviewStorySurface {...args} />,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof ReviewDiffPanel>;

export default meta;

type Story = StoryObj<typeof meta>;

export const LastTurnWithoutFileTree: Story = {};

export const LastTurnWithFileTree: Story = {
  args: {
    initialFileTreeOpen: true,
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
