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
          "Focused request-card coverage for approval, request-user-input, answered user-input transcript rows, and the implement-plan follow-up surface.",
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

export const AnsweredUserInput: Story = {
  render: () => (
    <RequestSurface
      title="Answered User Input"
      description="Collapsed transcript row for resolved request-user-input prompts."
    >
      <UserInputTranscriptView
        item={{
          ...THREAD_REQUEST_CARD_STORY_DATA.answeredUserInput,
          userInputQuestions: [...THREAD_REQUEST_CARD_STORY_DATA.answeredUserInput.userInputQuestions],
          userInputAnswers: {
            thread_scope: [...THREAD_REQUEST_CARD_STORY_DATA.answeredUserInput.userInputAnswers.thread_scope],
            storybook_shape: [...THREAD_REQUEST_CARD_STORY_DATA.answeredUserInput.userInputAnswers.storybook_shape],
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
          ...THREAD_REQUEST_CARD_STORY_DATA.answeredUserInputEmpty,
          userInputQuestions: [...THREAD_REQUEST_CARD_STORY_DATA.answeredUserInputEmpty.userInputQuestions],
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
          ...THREAD_REQUEST_CARD_STORY_DATA.answeredUserInputInProgress,
          userInputQuestions: [...THREAD_REQUEST_CARD_STORY_DATA.answeredUserInputInProgress.userInputQuestions],
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

export const McpServerElicitation: Story = {
  render: () => (
    <RequestSurface
      title="MCP Elicitation"
      description="Codex-style MCP approval card with header, message, expandable details, and footer actions."
    >
      <CodexMcpElicitationRequestCard
        request={THREAD_REQUEST_CARD_STORY_DATA.mcpServerElicitation}
        onRespond={async () => { }}
      />
    </RequestSurface>
  ),
};
