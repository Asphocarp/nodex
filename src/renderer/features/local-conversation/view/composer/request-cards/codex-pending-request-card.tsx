import type { ThreadComposerShellPendingRequestModel, ThreadStageActions } from "../../../thread-stage-types";
import { CodexApprovalRequestCard } from "./codex-approval-request-card";
import { CodexImplementPlanRequestCard } from "./codex-implement-plan-request-card";
import { CodexMcpElicitationRequestCard } from "./codex-mcp-elicitation-request-card";
import { CodexOptionPickerRequestCard } from "./codex-option-picker-request-card";
import { CodexPermissionRequestCard } from "./codex-permission-request-card";
import { CodexSetupCodexStepRequestCard } from "./codex-setup-codex-step-request-card";
import { CodexUserInputRequestCard } from "./codex-user-input-request-card";
import { NodexAgentAuthorizationRequestCard } from "./nodex-agent-authorization-request-card";

interface CodexPendingRequestCardProps {
  entry: ThreadComposerShellPendingRequestModel;
  actions: ThreadStageActions;
  onManualApproval?: (conversationId: string) => void | Promise<void>;
}

const PLAN_IMPLEMENTATION_PROMPT_PREFIX = "PLEASE IMPLEMENT THIS PLAN:";

function isAcceptedApprovalDecision(
  response: Parameters<ThreadStageActions["onRespondApproval"]>[1],
): boolean {
  return response.decision !== "decline" && response.decision !== "cancel";
}

export function CodexPendingRequestCard({
  entry,
  actions,
  onManualApproval,
}: CodexPendingRequestCardProps) {
  const approvalQuestionActor = entry.surface === "backgroundThread" && entry.actorName?.trim()
    ? (
        <span className="font-medium text-token-foreground">
          {entry.actorName.trim()}
        </span>
      )
    : undefined;

  switch (entry.request.type) {
    case "approval": {
      const request = entry.request;
      return (
        <CodexApprovalRequestCard
          request={request}
          requestItem={entry.requestItem}
          actorName={entry.actorName ?? null}
          approvalQuestionActor={approvalQuestionActor}
          onRespond={async (requestId, response) => {
            await actions.onRespondApproval(
              requestId,
              response,
              { conversationId: entry.conversationId },
            );
            if (isAcceptedApprovalDecision(response)) {
              await onManualApproval?.(entry.conversationId);
            }
          }}
          onSubmitLocalFollowup={async (prompt) => {
            await actions.onSendPrompt(prompt);
          }}
        />
      );
    }
    case "userInput":
      return (
        <CodexUserInputRequestCard
          request={entry.request}
          onInterrupt={async () => {
            await actions.onInterruptTurn(entry.request.turnId);
          }}
          onRespond={async (requestId, answers) => {
            await actions.onRespondUserInput(requestId, answers, { conversationId: entry.conversationId });
          }}
        />
      );
    case "mcpServerElicitation":
      return (
        <CodexMcpElicitationRequestCard
          request={entry.request}
          onRespond={async (requestId, action) => {
            await actions.onRespondMcpElicitation(requestId, action, { conversationId: entry.conversationId });
          }}
        />
      );
    case "permissionRequest":
      return (
        <CodexPermissionRequestCard
          request={entry.request}
          onRespond={async (requestId, response) => {
            await (actions.onRespondPermissionRequest ?? (async () => {}))(
              requestId,
              response,
              { conversationId: entry.conversationId },
            );
            await onManualApproval?.(entry.conversationId);
          }}
          onSubmitLocalFollowup={async (prompt) => {
            await actions.onSendPrompt(prompt);
          }}
        />
      );
    case "nodexAgentAuthorization":
      return (
        <NodexAgentAuthorizationRequestCard
          request={entry.request}
          onRespond={async (requestId, response) => {
            await (actions.onRespondNodexAgentAuthorization ?? (async () => {}))(
              requestId,
              response,
              { conversationId: entry.conversationId },
            );
          }}
        />
      );
    case "optionPicker":
      return (
        <CodexOptionPickerRequestCard
          request={entry.request}
          onRespond={async (requestId, response) => {
            await (actions.onRespondOptionPicker ?? (async () => {}))(
              requestId,
              response,
              { conversationId: entry.conversationId },
            );
          }}
        />
      );
    case "setupCodexStep":
      return (
        <CodexSetupCodexStepRequestCard
          request={entry.request}
          onRespond={async (requestId, response) => {
            await (actions.onRespondSetupCodexStep ?? (async () => {}))(
              requestId,
              response,
              { conversationId: entry.conversationId },
            );
          }}
        />
      );
    case "implementPlan":
      const request = entry.request;
      return (
        <CodexImplementPlanRequestCard
          request={request}
          onRespond={async (response) => {
            await actions.onResolvePlanImplementationRequest(entry.conversationId, request.turnId);
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
