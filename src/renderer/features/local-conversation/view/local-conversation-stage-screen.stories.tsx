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
          "Two-hundred-turn transcript lifecycle check for the shared thread scroll shell: the core list owns windowing/pending reveal, the wrapper owns latest-turn follow and response spacer, and the footer catch-up state should stay stable during streaming.",
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
  parameters: {
    docs: {
      description: {
        story:
          "Search/navigation check for long virtualized transcripts: active matches reveal through the shared scroll API before DOM marks are applied, while prior pending reveals can be canceled.",
      },
    },
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

export const ToolCallMixed: Story = {
  args: {
    preset: "tool-call-mixed",
    isQueueingEnabled: false,
    collapseAgentBody: false,
  },
};

export const BlockedFixedContent: Story = {
  args: {
    preset: "blocked-fixed-content",
    isQueueingEnabled: false,
    collapseAgentBody: false,
  },
  parameters: {
    docs: {
      description: {
        story:
          "Production lifecycle fixture: a pending approval replaces the composer and suppresses active todo, aggregate diff, and Thinking, while the live patch row remains visible in the transcript.",
      },
    },
  },
};

export const ApprovalLane: Story = {
  args: {
    preset: "approval-lane",
    isQueueingEnabled: false,
    collapseAgentBody: false,
  },
};

export const FileApprovalLane: Story = {
  args: {
    preset: "file-approval-lane",
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

export const OnboardingInputLane: Story = {
  args: {
    preset: "onboarding-input-lane",
    isQueueingEnabled: false,
    collapseAgentBody: false,
  },
};

export const PermissionLane: Story = {
  args: {
    preset: "permission-lane",
    isQueueingEnabled: false,
    collapseAgentBody: false,
  },
};

export const McpElicitationLane: Story = {
  args: {
    preset: "mcp-elicitation-lane",
    isQueueingEnabled: false,
    collapseAgentBody: false,
  },
};

export const OptionPickerLane: Story = {
  args: {
    preset: "option-picker-lane",
    isQueueingEnabled: false,
    collapseAgentBody: false,
  },
};

export const SetupRoleLane: Story = {
  args: {
    preset: "setup-role-lane",
    isQueueingEnabled: false,
    collapseAgentBody: false,
  },
};

export const SetupTaskLane: Story = {
  args: {
    preset: "setup-task-lane",
    isQueueingEnabled: false,
    collapseAgentBody: false,
  },
};

export const SetupContextLane: Story = {
  args: {
    preset: "setup-context-lane",
    isQueueingEnabled: false,
    collapseAgentBody: false,
  },
};

export const AutoReviewNudge: Story = {
  args: {
    preset: "auto-review-nudge",
    permissionMode: "auto",
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

export const BackgroundPermissionOption: Story = {
  args: {
    preset: "background-permission-option",
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
