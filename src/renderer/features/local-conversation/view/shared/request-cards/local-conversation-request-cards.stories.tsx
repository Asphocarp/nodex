import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";
import { NodexTooltipProvider as TooltipProvider } from "@/components/ui/tooltip";
import {
  UserInputComposerView,
  UserInputTranscriptView,
} from "./local-conversation-request-cards";
import { CodexApprovalRequestCard } from "../../composer/request-cards/codex-approval-request-card";
import { CodexImplementPlanRequestCard } from "../../composer/request-cards/codex-implement-plan-request-card";
import { CodexMcpElicitationRequestCard } from "../../composer/request-cards/codex-mcp-elicitation-request-card";
import { CodexOptionPickerRequestCard } from "../../composer/request-cards/codex-option-picker-request-card";
import { CodexPermissionRequestCard } from "../../composer/request-cards/codex-permission-request-card";
import {
  CodexSetupCodexStepRequestCard,
  CodexSetupContextRequestCardView,
} from "../../composer/request-cards/codex-setup-codex-step-request-card";
import { CodexUserInputRequestCard } from "../../composer/request-cards/codex-user-input-request-card";
import { NodexAgentAuthorizationRequestCard } from "../../composer/request-cards/nodex-agent-authorization-request-card";
import { AutoReviewApprovalNudge as AutoReviewApprovalNudgeView } from "../../composer/auto-review-approval-nudge";
import { THREAD_REQUEST_CARD_STORY_DATA } from "../../thread-stage-story-fixtures";

function RequestSurface({
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
      <TooltipProvider>
        <div className="max-w-3xl">{children}</div>
      </TooltipProvider>
    </div>
  );
}

const meta = {
  title: "Workbench/Threads/Request Cards",
  component: RequestSurface,
  parameters: {
    docs: {
      description: {
        component:
          "Focused request-card coverage for approval, permissions, option picker, request-user-input, answered user-input transcript rows, and the implement-plan follow-up surface.",
      },
    },
  },
  args: {
    title: "Request card",
    description: "Thread request surface.",
    children: null,
  },
} satisfies Meta<typeof RequestSurface>;

export default meta;

type Story = StoryObj<typeof meta>;

const setupRequest = {
  type: "setupCodexStep" as const,
  requestId: "setup_codex_story",
  projectId: "project-story",
  threadId: "thread-story",
  turnId: "turn-story",
  itemId: "setup-codex-story-item",
  step: "role" as const,
  createdAt: 1,
};

export const Approval: Story = {
  render: () => (
    <RequestSurface
      title="Approval Request"
      description="Codex-style ask-for-permission card with inline command preview, option list, freeform decline path, and footer actions."
    >
      <CodexApprovalRequestCard
        request={THREAD_REQUEST_CARD_STORY_DATA.approval}
        onRespond={async () => { }}
        onSubmitLocalFollowup={async () => { }}
      />
    </RequestSurface>
  ),
};

export const FileApprovalPreview: Story = {
  render: () => (
    <RequestSurface
      title="File Approval Preview"
      description="File approvals render the same path-keyed patch preview model as in-thread file-change rows, deduping repeated same-path edits into one preview row."
    >
      <CodexApprovalRequestCard
        request={THREAD_REQUEST_CARD_STORY_DATA.fileApproval}
        requestItem={THREAD_REQUEST_CARD_STORY_DATA.fileApprovalItem}
        onRespond={async () => { }}
        onSubmitLocalFollowup={async () => { }}
      />
    </RequestSurface>
  ),
};

export const BackgroundApproval: Story = {
  render: () => (
    <RequestSurface
      title="Background Approval Request"
      description="Child-agent approval uses the same ask-for-permission card shell and renders the agent name inline in the prompt instead of as a separate header."
    >
      <CodexApprovalRequestCard
        request={{
          ...THREAD_REQUEST_CARD_STORY_DATA.approval,
          approvalReason: undefined,
          reason: undefined,
        }}
        actorName="Worker 1"
        approvalQuestionActor={<span className="font-medium">Worker 1</span>}
        onRespond={async () => { }}
        onSubmitLocalFollowup={async () => { }}
      />
    </RequestSurface>
  ),
};

export const UserInput: Story = {
  render: () => (
    <RequestSurface
      title="User Input Request"
      description="Multi-question request-user-input composer including option and free-form flows."
    >
      <UserInputComposerView
        request={THREAD_REQUEST_CARD_STORY_DATA.userInput}
        onRespond={async () => { }}
      />
    </RequestSurface>
  ),
};

export const OnboardingDynamicInput: Story = {
  render: () => (
    <RequestSurface
      title="Onboarding Dynamic Input"
      description="Dynamic onboarding forces a Something else answer for every question and resolves dismiss with an empty response instead of interrupting the thread."
    >
      <CodexUserInputRequestCard
        request={{
          ...THREAD_REQUEST_CARD_STORY_DATA.userInput,
          requestId: "onboarding_dynamic_input_story",
          isOnboardingDynamicInput: true,
        }}
        onRespond={async () => { }}
      />
    </RequestSurface>
  ),
};

export const OptionPicker: Story = {
  render: () => (
    <RequestSurface
      title="Option Picker Request"
      description="Native option-picker request with single or multi-select chips, an inline freeform answer, explicit skip/dismiss actions, and the canonical submit response."
    >
      <CodexOptionPickerRequestCard
        request={THREAD_REQUEST_CARD_STORY_DATA.optionPicker}
        onRespond={async () => { }}
      />
    </RequestSurface>
  ),
};

export const SetupRole: Story = {
  render: () => (
    <RequestSurface
      title="Setup Role"
      description="Onboarding role picker with shuffled multi-select roles, a fixed Something else tail, and canonical role IDs in the response."
    >
      <CodexSetupCodexStepRequestCard
        request={setupRequest}
        onRespond={async () => { }}
      />
    </RequestSurface>
  ),
};

export const SetupTask: Story = {
  render: () => (
    <RequestSurface
      title="Setup First Task"
      description="Role-derived first-task suggestions share the native input form and retain the freeform, skip, and dismiss paths."
    >
      <CodexSetupCodexStepRequestCard
        request={{ ...setupRequest, step: "task" }}
        onRespond={async () => { }}
      />
    </RequestSurface>
  ),
};

export const SetupContext: Story = {
  render: () => (
    <RequestSurface
      title="Setup Context Sources"
      description="Context source picker with recommended apps, connected/install states, searchable browse popover, and continue/skip/dismiss actions."
    >
      <CodexSetupContextRequestCardView
        request={{ ...setupRequest, step: "context" }}
        recommendedSources={[
          {
            id: "google-drive",
            name: "Google Drive",
            description: "Find launch docs and source material",
            logoUrl: null,
            logoUrlDark: null,
            connected: true,
          },
          {
            id: "slack",
            name: "Slack",
            description: "Read decisions and team context",
            logoUrl: null,
            logoUrlDark: null,
            connected: false,
          },
        ]}
        browseSources={[
          {
            id: "google-drive",
            name: "Google Drive",
            description: "Find launch docs and source material",
            logoUrl: null,
            logoUrlDark: null,
            connected: true,
          },
          {
            id: "slack",
            name: "Slack",
            description: "Read decisions and team context",
            logoUrl: null,
            logoUrlDark: null,
            connected: false,
          },
          {
            id: "gmail",
            name: "Gmail",
            description: "Read customer and sales threads",
            logoUrl: null,
            logoUrlDark: null,
            connected: false,
          },
        ]}
        onConnectSource={() => { }}
        onRespond={async () => { }}
      />
    </RequestSurface>
  ),
};

export const AnsweredUserInput: Story = {
  render: () => (
    <RequestSurface
      title="Answered User Input"
      description="Collapsed transcript row for resolved request-user-input prompts."
    >
      <UserInputTranscriptView
        item={{
          ...THREAD_REQUEST_CARD_STORY_DATA.userInputResponse,
          userInputQuestions: [...THREAD_REQUEST_CARD_STORY_DATA.userInputResponse.userInputQuestions],
          userInputAnswers: {
            thread_scope: [...THREAD_REQUEST_CARD_STORY_DATA.userInputResponse.userInputAnswers.thread_scope],
            storybook_shape: [...THREAD_REQUEST_CARD_STORY_DATA.userInputResponse.userInputAnswers.storybook_shape],
          },
        }}
      />
    </RequestSurface>
  ),
};

export const AnsweredUserInputEmpty: Story = {
  render: () => (
    <RequestSurface
      title="Answered User Input Empty"
      description="Completed historical response row with no recorded answers, matching the Codex Electron summary-only branch."
    >
      <UserInputTranscriptView
        item={{
          ...THREAD_REQUEST_CARD_STORY_DATA.userInputResponseEmpty,
          userInputQuestions: [...THREAD_REQUEST_CARD_STORY_DATA.userInputResponseEmpty.userInputQuestions],
          userInputAnswers: {},
        }}
      />
    </RequestSurface>
  ),
};

export const AnsweredUserInputInProgress: Story = {
  render: () => (
    <RequestSurface
      title="Answered User Input In Progress"
      description="Streaming shimmer row used before a request-user-input exchange is completed."
    >
      <UserInputTranscriptView
        item={{
          ...THREAD_REQUEST_CARD_STORY_DATA.userInputResponseInProgress,
          userInputQuestions: [...THREAD_REQUEST_CARD_STORY_DATA.userInputResponseInProgress.userInputQuestions],
          userInputAnswers: {},
        }}
      />
    </RequestSurface>
  ),
};

export const ImplementPlan: Story = {
  render: () => (
    <RequestSurface
      title="Implement Plan"
      description="Synthesized follow-up surface shown after a completed turn ends with a non-empty plan."
    >
      <CodexImplementPlanRequestCard
        request={THREAD_REQUEST_CARD_STORY_DATA.implementPlan}
        onRespond={async () => { }}
      />
    </RequestSurface>
  ),
};

export const PermissionRequest: Story = {
  render: () => (
    <RequestSurface
      title="Permission Request"
      description="Codex-style permissions card with normalized access details, skip, turn allow, and session allow actions."
    >
      <CodexPermissionRequestCard
        request={THREAD_REQUEST_CARD_STORY_DATA.permissionRequest}
        onRespond={async () => { }}
      />
    </RequestSurface>
  ),
};

export const NodexAgentAuthorization: Story = {
  render: () => (
    <RequestSurface
      title="Nodex Agent Authorization"
      description="Resource-scoped Nodex consent with one-shot, task, and persistent Project choices."
    >
      <NodexAgentAuthorizationRequestCard
        request={{
          type: "nodexAgentAuthorization",
          requestId: "nodex-auth-story",
          projectId: "project-story",
          threadId: "thread-story",
          turnId: "turn-story",
          itemId: "call-story",
          tool: "update_page",
          effect: "write",
          preview: {
            title: "Append rollout plan",
            summary: "Append four Blocks to “Launch brief”.",
            details: [
              { label: "Card", value: "Launch brief" },
              { label: "Method", value: "insert" },
            ],
            markdownPreview: "## Rollout\n\n- Alpha cohort\n- Measure activation\n- Expand gradually",
          },
          createdAt: 1,
        }}
        onRespond={async () => { }}
      />
    </RequestSurface>
  ),
};

export const NodexAgentDestructiveAuthorization: Story = {
  render: () => (
    <RequestSurface
      title="Destructive Nodex Authorization"
      description="Destructive consent keeps the same resource-scoped one-shot, task, and Project choices."
    >
      <NodexAgentAuthorizationRequestCard
        request={{
          type: "nodexAgentAuthorization",
          requestId: "nodex-destructive-auth-story",
          projectId: "project-story",
          threadId: "thread-story",
          turnId: "turn-story",
          itemId: "call-destructive-story",
          tool: "update_page",
          effect: "destructive",
          preview: {
            title: "Replace launch brief body",
            summary: "Delete three existing Blocks and create the replacement outline.",
            details: [
              { label: "Card", value: "Launch brief" },
              { label: "Method", value: "replace" },
            ],
            markdownPreview: "# Launch brief\n\n## Revised scope\n\nThe former rollout sections will be removed.",
          },
          createdAt: 1,
        }}
        onRespond={async () => { }}
      />
    </RequestSurface>
  ),
};

export const McpServerElicitation: Story = {
  render: () => (
    <RequestSurface
      title="MCP Elicitation"
      description="Codex-style MCP elicitation card with form inputs, skip/cancel, and contentful continue responses."
    >
      <CodexMcpElicitationRequestCard
        request={THREAD_REQUEST_CARD_STORY_DATA.mcpServerElicitation}
        onRespond={async () => { }}
      />
    </RequestSurface>
  ),
};

export const AutoReviewApprovalNudge: Story = {
  render: () => (
    <RequestSurface
      title="Auto-review Approval Nudge"
      description="Composer-replacement prompt offered after repeated eligible manual approvals, with persistent manual dismissal and the guardian-approval opt-in action."
    >
      <AutoReviewApprovalNudgeView
        threadId="thread-auto-review-nudge-story"
        actions={{
          onPermissionModeChange: async () => { },
        }}
      />
    </RequestSurface>
  ),
};
