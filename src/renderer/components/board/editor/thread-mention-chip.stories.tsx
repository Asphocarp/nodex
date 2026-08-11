import type { Meta, StoryObj } from "@storybook/react-vite";
import type { CodexThreadSummary } from "@/lib/types";
import {
  ThreadMentionInlineContentView,
  ThreadMentionRuntimeProvider,
} from "./thread-mention-chip";
import { ReadonlyNfmBlockNotePreview } from "./readonly-nfm-blocknote-preview";

const BASE_THREAD: CodexThreadSummary = {
  threadId: "019b5b4d-7f31-7b20-8c0d-c52c55ea2e42",
  projectId: "project-1",
  source: null,
  threadName: "Investigate NFM parser behavior",
  threadPreview: "Trace the inline parser and serializer paths.",
  modelProvider: "openai",
  cwd: "/Users/asc/repo/nodex2",
  statusType: "idle",
  statusActiveFlags: [],
  archived: false,
  createdAt: 1,
  updatedAt: 2,
  linkedAt: "2026-06-19T00:00:00.000Z",
};

function ThreadMentionChipStorySurface({
  uuid,
  thread,
  resolving = false,
  missing = false,
}: {
  uuid: string;
  thread?: CodexThreadSummary | null;
  resolving?: boolean;
  missing?: boolean;
}) {
  return (
    <div className="max-w-xl rounded-lg bg-token-bg-fog p-3 text-token-foreground">
      <span className="text-sm text-token-foreground">
        Continue from{" "}
        <ThreadMentionRuntimeProvider
          value={{
            threads: thread ? { [thread.threadId]: thread } : {},
            resolvingIds: resolving ? new Set([uuid]) : new Set(),
            resolveThread: async () => (missing ? null : thread ?? null),
            openThread: () => undefined,
          }}
        >
          <ThreadMentionInlineContentView inlineContent={{ props: { uuid } }} />
        </ThreadMentionRuntimeProvider>{" "}
        before sending the next note.
      </span>
    </div>
  );
}

const meta = {
  title: "Board/Editor/Thread Mention",
  component: ThreadMentionChipStorySurface,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component: "Focused coverage for minimalist NFM thread mentions rendered from `<mention-thread uuid=\"...\" />`.",
      },
    },
  },
} satisfies Meta<typeof ThreadMentionChipStorySurface>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Resolved: Story = {
  args: {
    uuid: BASE_THREAD.threadId,
    thread: BASE_THREAD,
  },
};

export const Running: Story = {
  args: {
    uuid: BASE_THREAD.threadId,
    thread: {
      ...BASE_THREAD,
      statusType: "active",
      threadName: "Run migration check",
    },
  },
};

export const Waiting: Story = {
  args: {
    uuid: BASE_THREAD.threadId,
    thread: {
      ...BASE_THREAD,
      statusType: "active",
      statusActiveFlags: ["waitingOnUserInput"],
      threadName: "Review approval branch",
    },
  },
};

export const Archived: Story = {
  args: {
    uuid: BASE_THREAD.threadId,
    thread: {
      ...BASE_THREAD,
      archived: true,
      threadName: "Archived implementation spike",
    },
  },
};

export const Missing: Story = {
  args: {
    uuid: "019missing-thread",
    thread: null,
    missing: true,
  },
};

export const LongTitle: Story = {
  args: {
    uuid: BASE_THREAD.threadId,
    thread: {
      ...BASE_THREAD,
      threadName: "A very long thread title that should truncate cleanly inside a minimalist inline mention without shifting surrounding editor text",
    },
  },
};

export const ReadonlyPreview: Story = {
  args: {
    uuid: BASE_THREAD.threadId,
    thread: {
      ...BASE_THREAD,
      threadName: "Readonly history preview mention",
    },
  },
  render: (args) => (
    <div className="w-[28rem] rounded-lg bg-token-bg-fog p-3 text-token-foreground">
      <ReadonlyNfmBlockNotePreview
        content={`Captured note with <mention-thread uuid="${args.uuid}" /> inside readonly history.`}
        projectId="project-1"
        pageId="card-1"
        historyId={1}
      />
    </div>
  ),
};
