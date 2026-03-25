import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";
import { THREAD_TRANSCRIPT_SPECIAL_STORY_ITEMS } from "../thread-stage-story-fixtures";
import { LOCAL_CONVERSATION_CONTENT_CLASS_NAME } from "./local-conversation-view-constants";
import { AutomaticApprovalReviewSurface } from "./automatic-approval-review-surface";
import { MultiAgentActionSurface } from "./multi-agent-action-surface";
import { ReasoningSurface } from "./reasoning-surface";
import { TodoListSurface } from "./todo-list-surface";

function StorySurface({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-[320px] rounded-[24px] border border-(--border) bg-(--background) p-5 shadow-[0_18px_48px_rgba(0,0,0,0.16)]">
      <div className="mb-4 max-w-2xl">
        <div className="text-sm font-semibold text-(--foreground)">{title}</div>
        <div className="mt-1 text-sm/relaxed text-(--foreground-secondary)">{description}</div>
      </div>
      <div className="max-w-3xl">{children}</div>
    </div>
  );
}

function ConversationStorySurface({ children }: { children: ReactNode }) {
  return (
    <div data-thread-find-target="conversation" className={LOCAL_CONVERSATION_CONTENT_CLASS_NAME}>
      {children}
    </div>
  );
}

const meta = {
  title: "Workbench/Threads/Transcript Specials",
  component: StorySurface,
  parameters: {
    docs: {
      description: {
        component:
          "Focused parity coverage for Codex-style transcript-special surfaces such as reasoning, todo lists, automatic approval review, and multi-agent activity.",
      },
    },
  },
  args: {
    title: "Transcript special",
    description: "Focused transcript renderer surface.",
    children: null,
  },
} satisfies Meta<typeof StorySurface>;

export default meta;

type Story = StoryObj<typeof meta>;

export const ReasoningStreaming: Story = {
  render: () => (
    <StorySurface
      title="Reasoning Streaming"
      description="The streaming reasoning renderer keeps the preview body open and uses the Codex Thinking shimmer summary."
    >
      <ConversationStorySurface>
        <ReasoningSurface
          item={{
            markdownText: "**Investigating**\n\nChecking the failing story state.\n\n- comparing bundle behavior\n- checking transcript buckets",
            status: "inProgress",
          }}
          parseIncompleteMarkdown
        />
      </ConversationStorySurface>
    </StorySurface>
  ),
};

export const ReasoningCompleted: Story = {
  render: () => (
    <StorySurface
      title="Reasoning Completed"
      description="Completed reasoning collapses back to the Codex Thought summary and can be reopened on demand."
    >
      <ConversationStorySurface>
        <ReasoningSurface
          item={{
            markdownText: "**Investigating**\n\nChecking the failing story state.\n\n- comparing bundle behavior\n- checking transcript buckets",
            status: "completed",
          }}
        />
      </ConversationStorySurface>
    </StorySurface>
  ),
};

export const TodoList: Story = {
  render: () => (
    <StorySurface
      title="Todo List"
      description="The full Codex-style todo card shows completion progress, current-step emphasis, and the measured expandable body."
    >
      <ConversationStorySurface>
        <TodoListSurface
          item={{
            markdownText: [
              "- [x] Audit the bundle",
              "- [ ] Port the todo shell",
              "- [ ] Update stories and tests",
            ].join("\n"),
            status: "inProgress",
            rawItem: undefined,
          }}
        />
      </ConversationStorySurface>
    </StorySurface>
  ),
};

export const TodoListCompleted: Story = {
  render: () => (
    <StorySurface
      title="Todo List Completed"
      description="Completed todo plans can also render from structured raw plan payloads when available."
    >
      <ConversationStorySurface>
        <TodoListSurface
          item={{
            markdownText: "",
            status: "completed",
            rawItem: {
              plan: [
                { step: "Audit the bundle", status: "completed" },
                { step: "Port the todo shell", status: "completed" },
                { step: "Update stories and tests", status: "completed" },
              ],
            },
          }}
        />
      </ConversationStorySurface>
    </StorySurface>
  ),
};

export const AutomaticApprovalReviewCompleted: Story = {
  render: () => (
    <StorySurface
      title="Automatic Approval Review Completed"
      description="Completed automatic approval review rows stay compact until their rationale is explicitly expanded."
    >
      <ConversationStorySurface>
        <AutomaticApprovalReviewSurface
          item={THREAD_TRANSCRIPT_SPECIAL_STORY_ITEMS.automaticApprovalReviewCompleted}
        />
      </ConversationStorySurface>
    </StorySurface>
  ),
};

export const AutomaticApprovalReviewInProgress: Story = {
  render: () => (
    <StorySurface
      title="Automatic Approval Review In Progress"
      description="The in-progress guardian review row uses the reviewing state and keeps the same compact transcript lane."
    >
      <ConversationStorySurface>
        <AutomaticApprovalReviewSurface
          item={THREAD_TRANSCRIPT_SPECIAL_STORY_ITEMS.automaticApprovalReviewInProgress}
        />
      </ConversationStorySurface>
    </StorySurface>
  ),
};

export const MultiAgentActionCompleted: Story = {
  render: () => (
    <StorySurface
      title="Multi-Agent Action Completed"
      description="Settled multi-agent activity stays in its dedicated transcript surface and can be expanded to inspect the grouped rows."
    >
      <ConversationStorySurface>
        <MultiAgentActionSurface items={THREAD_TRANSCRIPT_SPECIAL_STORY_ITEMS.multiAgentSettled} />
      </ConversationStorySurface>
    </StorySurface>
  ),
};

export const MultiAgentActionInProgress: Story = {
  render: () => (
    <StorySurface
      title="Multi-Agent Action In Progress"
      description="Live background agent activity remains open and keeps the same measured Codex-style transcript lane while work is still running."
    >
      <ConversationStorySurface>
        <MultiAgentActionSurface items={THREAD_TRANSCRIPT_SPECIAL_STORY_ITEMS.multiAgentInProgress} />
      </ConversationStorySurface>
    </StorySurface>
  ),
};
