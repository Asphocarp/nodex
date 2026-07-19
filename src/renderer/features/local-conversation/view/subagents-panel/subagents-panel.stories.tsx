import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ThreadComposerShellBackgroundAgentRowModel } from "../../thread-stage-types";
import {
  SubagentsPanelDetailHeader,
  SubagentsPanelOverviewContent,
} from "./subagents-panel";

const now = Date.now();

function buildRow(
  conversationId: string,
  overrides: Partial<ThreadComposerShellBackgroundAgentRowModel>,
): ThreadComposerShellBackgroundAgentRowModel {
  return {
    conversationId,
    parentConversationId: "thread-root",
    parentTurnKey: "turn-root",
    displayName: conversationId,
    actorName: conversationId,
    agentRole: null,
    spawnModel: null,
    status: "done",
    statusSummary: null,
    lastAssistantMessage: null,
    lastAssistantMessageAtMs: null,
    recencyAtMs: 0,
    showInlineActivity: true,
    diffStats: null,
    role: "backgroundChild",
    ...overrides,
  };
}

const activeAndDoneRows = [
  buildRow("Scout", {
    status: "active",
    statusSummary: "checking renderer routes",
    recencyAtMs: now,
  }),
  buildRow("Planner with an intentionally long display name", {
    status: "waiting",
    statusSummary: "waiting for the root agent",
    recencyAtMs: now - 60_000,
  }),
  buildRow("Reviewer", {
    lastAssistantMessage: "Verified the API boundary and the panel routing behavior.",
    lastAssistantMessageAtMs: now - 22 * 60_000,
    recencyAtMs: now - 22 * 60_000,
  }),
  buildRow("Builder", {
    lastAssistantMessage: "Implemented the relationship hydration path.",
    lastAssistantMessageAtMs: now - 34 * 60_000,
    recencyAtMs: now - 34 * 60_000,
  }),
];

const meta = {
  title: "Local Conversation/Subagents Panel",
  component: SubagentsPanelOverviewContent,
  parameters: {
    layout: "fullscreen",
  },
  decorators: [
    (Story) => (
      <div className="h-[620px] w-[360px] bg-token-main-surface-primary">
        <Story />
      </div>
    ),
  ],
  args: {
    rootThreadId: "thread-root",
    rows: activeAndDoneRows,
    onSelect: () => undefined,
    onVisibleRowsChange: () => undefined,
  },
} satisfies Meta<typeof SubagentsPanelOverviewContent>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ActiveAndDone: Story = {};

export const NoActiveSubagents: Story = {
  args: {
    rows: activeAndDoneRows.filter((row) => row.status === "done"),
  },
};

export const LoadingPreviews: Story = {
  args: {
    rows: [
      buildRow("Scout", {
        status: "active",
        statusSummary: "Working",
        recencyAtMs: now,
      }),
      buildRow("Planner", {
        status: "waiting",
        statusSummary: null,
        recencyAtMs: now - 1,
      }),
    ],
  },
};

export const SelectedReadOnlyDetailHeader: Story = {
  parameters: {
    docs: {
      description: {
        story: "The selected subagent route places this header above a read-only transcript and intentionally renders no composer.",
      },
    },
  },
  render: () => (
    <SubagentsPanelDetailHeader
      displayName="Reviewer"
      threadId="thread-reviewer"
      onBack={() => undefined}
    />
  ),
};
