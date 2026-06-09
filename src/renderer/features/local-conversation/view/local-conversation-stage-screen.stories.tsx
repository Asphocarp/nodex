import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  ThreadStageDevStoryPage,
} from "./thread-stage-dev-story";
import { THREAD_STAGE_STORY_DEFAULT_PRESET } from "./thread-stage-story-fixtures";

const meta = {
  title: "Workbench/Threads/Stage Screen",
  component: ThreadStageDevStoryPage,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Production-backed local-conversation stage scenarios built on the real thread projection pipeline. Presets are separate stories; controls only tune scene-wide settings.",
      },
    },
  },
  args: {
    preset: THREAD_STAGE_STORY_DEFAULT_PRESET.id,
    permissionMode: "auto",
    authenticatedAccount: true,
    isQueueingEnabled: false,
    collapseAgentBody: true,
  },
  argTypes: {
    permissionMode: {
      control: "inline-radio",
      options: ["auto", "guardian-approvals", "full-access", "custom"],
    },
    authenticatedAccount: {
      control: "boolean",
    },
    isQueueingEnabled: {
      control: "boolean",
    },
    collapseAgentBody: {
      control: "boolean",
    },
    renderPreview: {
      table: {
        disable: true,
      },
    },
  },
} satisfies Meta<typeof ThreadStageDevStoryPage>;

export default meta;

type Story = StoryObj<typeof meta>;

export const NewThread: Story = {
  args: {
    isQueueingEnabled: false,
  },
};

export const NewThreadNarrow: Story = {
  args: {
    isQueueingEnabled: false,
  },
  parameters: {
    chromatic: {
      viewports: [390],
    },
  },
};

export const ExistingEmpty: Story = {
  args: {
    preset: "existing-empty",
    isQueueingEnabled: false,
  },
};

export const Resuming: Story = {
  args: {
    preset: "resuming",
    isQueueingEnabled: false,
  },
};

export const Streaming: Story = {
  args: {
    preset: "streaming",
    isQueueingEnabled: false,
    collapseAgentBody: false,
  },
};

export const LongThreadStreaming: Story = {
  args: {
    preset: "long-thread-streaming",
    isQueueingEnabled: false,
    collapseAgentBody: false,
  },
  parameters: {
    docs: {
      description: {
        story:
          "Parity check for the Codex-style flow footer and shared thread scroll shell: the transcript keeps its natural-height root, the viewport owns the inner width wrapper and bottom gap, and follow-latest should stay stable during long streaming turns.",
      },
    },
  },
};

export const LongThreadSearchOpen: Story = {
  args: {
    preset: "long-thread-search-open",
    isQueueingEnabled: false,
    collapseAgentBody: false,
  },
};

export const CompletedCollapsed: Story = {
  args: {
    preset: "completed-collapsed",
    isQueueingEnabled: false,
  },
};

export const CompletedExpanded: Story = {
  args: {
    preset: "completed-collapsed",
    isQueueingEnabled: false,
    collapseAgentBody: false,
  },
};

export const ApprovalLane: Story = {
  args: {
    preset: "approval-lane",
    isQueueingEnabled: false,
    collapseAgentBody: false,
  },
};

export const UserInputLane: Story = {
  args: {
    preset: "user-input-lane",
    isQueueingEnabled: false,
    collapseAgentBody: false,
  },
};

export const ImplementPlan: Story = {
  args: {
    preset: "implement-plan",
    isQueueingEnabled: false,
  },
};

export const BackgroundActivity: Story = {
  args: {
    preset: "background-activity",
    isQueueingEnabled: false,
    collapseAgentBody: false,
  },
};

export const SearchOpen: Story = {
  args: {
    preset: "search-open",
    isQueueingEnabled: false,
  },
};

export const InlineEditOpen: Story = {
  args: {
    preset: "inline-edit-open",
    isQueueingEnabled: false,
  },
};

export const InlineEditFailure: Story = {
  args: {
    preset: "inline-edit-failure",
    isQueueingEnabled: false,
  },
};

export const LatestTurnFork: Story = {
  args: {
    preset: "latest-turn-fork",
    isQueueingEnabled: false,
  },
};

export const OlderTurnFork: Story = {
  args: {
    preset: "older-turn-fork",
    isQueueingEnabled: false,
  },
};
