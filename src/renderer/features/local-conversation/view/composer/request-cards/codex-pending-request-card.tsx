import type { ThreadComposerShellPendingRequestModel, ThreadStageActions } from "../../../thread-stage-types";
import { CodexApprovalRequestCard } from "./codex-approval-request-card";
import { CodexImplementPlanRequestCard } from "./codex-implement-plan-request-card";
import { CodexMcpElicitationRequestCard } from "./codex-mcp-elicitation-request-card";
import { CodexUserInputRequestCard } from "./codex-user-input-request-card";

interface CodexPendingRequestCardProps {
  entry: ThreadComposerShellPendingRequestModel;
  actions: ThreadStageActions;
}

const PLAN_IMPLEMENTATION_PROMPT_PREFIX = "PLEASE IMPLEMENT THIS PLAN:";

export function CodexPendingRequestCard({
  entry,
  actions,
}: CodexPendingRequestCardProps) {
  const approvalQuestionActor = entry.surface === "backgroundThread" && entry.actorName?.trim()
    ? (
        <span className="font-medium">
          {entry.actorName.trim()}
        </span>
      )
    : undefined;

  switch (entry.request.type) {
    case "approval":
      return (
        <CodexApprovalRequestCard
          request={entry.request}
          requestItem={entry.requestItem}
          actorName={entry.actorName ?? null}
          approvalQuestionActor={approvalQuestionActor}
          onRespond={actions.onRespondApproval}
          onSubmitLocalFollowup={async (prompt) => {
            await actions.onSendPrompt(prompt);
          }}
        />
      );
    case "userInput":
      return (
        <CodexUserInputRequestCard
          request={entry.request}
          onRespond={actions.onRespondUserInput}
        />
      );
    case "mcpServerElicitation":
      return (
        <CodexMcpElicitationRequestCard
          request={entry.request}
          onRespond={actions.onRespondMcpElicitation}
        />
      );
    case "implementPlan":
      const request = entry.request;
      return (
        <CodexImplementPlanRequestCard
          request={request}
          onRespond={async (response) => {
            actions.onResolvePlanImplementationRequest(entry.conversationId, request.turnId);
            if (response.type === "implement") {
              actions.onCollaborationModeChange("default");
              await actions.onSendPrompt(`${PLAN_IMPLEMENTATION_PROMPT_PREFIX}\n${request.planContent}`, {
                collaborationMode: "default",
              });
              return;
            }
            if (response.type === "followUp") {
              await actions.onSendPrompt(response.prompt);
            }
          }}
        />
      );
  }
}
