import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { CodexConversationItem } from "@/lib/types";
import { THREAD_TRANSCRIPT_SPECIAL_STORY_ITEMS } from "../thread-stage-story-fixtures";
import { LOCAL_CONVERSATION_CONTENT_CLASS_NAME } from "./local-conversation-view-constants";
import { AutomaticApprovalReviewSurface } from "./automatic-approval-review-surface";
import { MarkdownRenderer } from "./markdown/markdown-renderer";
import { MultiAgentActionSurface } from "./multi-agent-action-surface";
import { ReasoningSurface } from "./reasoning-surface";
import { TodoListSurface } from "./todo-list-surface";
import {
  ThreadContextCompactionBlock,
  ThreadStreamErrorBlock,
  ThreadSystemErrorBlock,
} from "../blocks/local-conversation-block-leaves";
import { buildRendererItemStream } from "../../projection/build-renderer-item-stream";
import type { ThreadTranscriptBlockModel } from "../../thread-stage-types";

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

function ElectronDarkThreadStorySurface({ children }: { children: ReactNode }) {
  return (
    <div data-codex-window-type="electron" className="dark electron-dark">
      <ConversationStorySurface>{children}</ConversationStorySurface>
    </div>
  );
}

function AutoOpenSurface({ children }: { children: ReactNode }) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const toggle = containerRef.current?.querySelector<HTMLElement>('button[aria-expanded="false"]');
    toggle?.click();
  }, []);

  return <div ref={containerRef}>{children}</div>;
}

const STREAMING_ASSISTANT_SEGMENTS =
  (
    "Investigating the Storybook regression while comparing the streaming transcript against the Codex Electron bundle, verifying tooltip sizing, dropdown chrome, shell command expansion, and per-word prose animation as new text arrives."
      .match(/\S+\s*/g) ?? []
  );

function StreamingAssistantMarkdownPreview() {
  const [visibleSegmentCount, setVisibleSegmentCount] = useState(1);
  const isComplete = visibleSegmentCount >= STREAMING_ASSISTANT_SEGMENTS.length;
  const content = STREAMING_ASSISTANT_SEGMENTS.slice(0, visibleSegmentCount).join("");

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (isComplete) {
        setVisibleSegmentCount(1);
        return;
      }

      setVisibleSegmentCount((current) => Math.min(current + 1, STREAMING_ASSISTANT_SEGMENTS.length));
    }, isComplete ? 1200 : 110);

    return () => {
      window.clearTimeout(timer);
    };
  }, [isComplete, visibleSegmentCount]);

  return (
    <div className="max-w-3xl rounded-2xl bg-token-main-surface-primary px-5 py-4 text-token-foreground">
      <MarkdownRenderer
        className="text-size-chat"
        content={content}
        parseIncompleteMarkdown={!isComplete}
        animateStreamingText={!isComplete}
      />
    </div>
  );
}

function buildSpecialTranscriptBlock(entry: CodexConversationItem): ThreadTranscriptBlockModel {
  const block = buildRendererItemStream({
    entries: [entry],
    requests: [],
  })[0];

  if (!block || !("entry" in block)) {
    throw new Error("Expected transcript-special story entry to project into a transcript block.");
  }

  return block;
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

export const AssistantStreamingWordFade: Story = {
  render: () => (
    <StorySurface
      title="Assistant Streaming Word Fade"
      description="This harness appends one word segment at a time so the Streamdown word fade can be inspected in the current Storybook theme without forcing an electron-dark surface."
    >
      <ConversationStorySurface>
        <StreamingAssistantMarkdownPreview />
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

export const ReasoningCompletedExpanded: Story = {
  render: () => (
    <StorySurface
      title="Reasoning Completed Expanded"
      description="Completed reasoning should reopen with the same measured accordion motion contract used by Codex Electron."
    >
      <ConversationStorySurface>
        <AutoOpenSurface>
          <ReasoningSurface
            item={{
              markdownText: "**Investigating**\n\nChecking the failing story state.\n\n- comparing bundle behavior\n- checking transcript buckets",
              status: "completed",
            }}
          />
        </AutoOpenSurface>
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

export const TodoListCollapsed: Story = {
  render: () => (
    <StorySurface
      title="Todo List Collapsed"
      description="Completed todo plans should collapse back to the same measured transcript accordion used by Codex Electron."
    >
      <ConversationStorySurface>
        <AutoOpenSurface>
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
        </AutoOpenSurface>
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

export const ContextCompactionCompleted: Story = {
  render: () => (
    <StorySurface
      title="Context Compaction Completed"
      description="Completed context compaction renders as the Codex divider row instead of a generic system banner."
    >
      <ConversationStorySurface>
        <ThreadContextCompactionBlock
          block={buildSpecialTranscriptBlock(THREAD_TRANSCRIPT_SPECIAL_STORY_ITEMS.contextCompactionCompleted)}
          isLatestTurn
          isStreamingTurn={false}
        />
      </ConversationStorySurface>
    </StorySurface>
  ),
};

export const StreamErrorReconnecting: Story = {
  render: () => (
    <StorySurface
      title="Stream Error Reconnecting"
      description="Poor-network retry is rendered as a dedicated thread-body stream error row instead of a shell reconnect overlay."
    >
      <ConversationStorySurface>
        <ThreadStreamErrorBlock
          block={buildSpecialTranscriptBlock(THREAD_TRANSCRIPT_SPECIAL_STORY_ITEMS.streamErrorReconnecting)}
          isLatestTurn
          isStreamingTurn
        />
      </ConversationStorySurface>
    </StorySurface>
  ),
};

export const SystemErrorFailed: Story = {
  render: () => (
    <StorySurface
      title="System Error Failed"
      description="Terminal non-retryable turn errors render as the dedicated Codex body row without the generic system banner shell."
    >
      <ConversationStorySurface>
        <ThreadSystemErrorBlock
          block={buildSpecialTranscriptBlock(THREAD_TRANSCRIPT_SPECIAL_STORY_ITEMS.systemErrorFailed)}
          isLatestTurn={false}
          isStreamingTurn={false}
        />
      </ConversationStorySurface>
    </StorySurface>
  ),
};

export const ContextCompactionInProgress: Story = {
  render: () => (
    <StorySurface
      title="Context Compaction In Progress"
      description="The in-progress compacting row keeps the same divider shell and swaps to the shimmer label."
    >
      <ConversationStorySurface>
        <ThreadContextCompactionBlock
          block={buildSpecialTranscriptBlock(THREAD_TRANSCRIPT_SPECIAL_STORY_ITEMS.contextCompactionInProgress)}
          isLatestTurn
          isStreamingTurn
        />
      </ConversationStorySurface>
    </StorySurface>
  ),
};

export const ContextCompactionInProgressElectronDark: Story = {
  render: () => (
    <StorySurface
      title="Context Compaction In Progress Electron Dark"
      description="Electron dark-mode thread shimmer keeps the Codex-style white highlight instead of switching to the dark override."
    >
      <ElectronDarkThreadStorySurface>
        <ThreadContextCompactionBlock
          block={buildSpecialTranscriptBlock(THREAD_TRANSCRIPT_SPECIAL_STORY_ITEMS.contextCompactionInProgress)}
          isLatestTurn
          isStreamingTurn
        />
      </ElectronDarkThreadStorySurface>
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

export const MultiAgentActionCompletedExpanded: Story = {
  render: () => (
    <StorySurface
      title="Multi-Agent Action Completed Expanded"
      description="Completed multi-agent activity should reopen with the same measured accordion timing as other transcript-special surfaces."
    >
      <ConversationStorySurface>
        <AutoOpenSurface>
          <MultiAgentActionSurface items={THREAD_TRANSCRIPT_SPECIAL_STORY_ITEMS.multiAgentSettled} />
        </AutoOpenSurface>
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
