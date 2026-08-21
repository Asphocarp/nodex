import type { ThreadComposerShellPendingRequestModel, ThreadStageActions } from "../../../thread-stage-types";
import { CodexApprovalRequestCard } from "./codex-approval-request-card";
import { CodexImplementPlanRequestCard } from "./codex-implement-plan-request-card";
import { CodexMcpElicitationRequestCard } from "./codex-mcp-elicitation-request-card";
import { CodexOptionPickerRequestCard } from "./codex-option-picker-request-card";
import { CodexPermissionRequestCard } from "./codex-permission-request-card";
import { CodexSetupCodexStepRequestCard } from "./codex-setup-codex-step-request-card";
import { CodexUserInputRequestCard } from "./codex-user-input-request-card";
import { NodexAgentAuthorizationRequestCard } from "./nodex-agent-authorization-request-card";
import type { ComposerIntelligenceController } from "../use-composer-intelligence-controller";
import { buildComposerIntelligenceTurnOverrides } from "../composer-intelligence-selection";
import { bindPendingRequestConversationActions } from "./pending-request-conversation-actions";

interface CodexPendingRequestCardProps {
  entry: ThreadComposerShellPendingRequestModel;
  actions: ThreadStageActions;
  intelligenceController?: ComposerIntelligenceController;
  onManualApproval?: (conversationId: string) => void | Promise<void>;
}

const PLAN_IMPLEMENTATION_PROMPT_PREFIX = "PLEASE IMPLEMENT THIS PLAN:";

export function CodexPendingRequestCard({
  entry,
  actions,
  intelligenceController,
  onManualApproval,
}: CodexPendingRequestCardProps) {
  const conversationActions = bindPendingRequestConversationActions({
    actions,
    conversationId: entry.conversationId,
    onManualApproval,
  });
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
          onRespond={conversationActions.respondApproval}
          onSubmitLocalFollowup={async (prompt) => {
            await actions.onSendPrompt(prompt);
          }}
        />
      );
    }
    case "userInput":
      return (
        <CodexUserInputRequestCard
          conversationId={entry.conversationId}
          request={entry.request}
          onInterrupt={async () => {
            await actions.onInterruptTurn(entry.request.turnId);
          }}
          onRespond={conversationActions.respondUserInput}
        />
      );
    case "mcpServerElicitation":
      return (
        <CodexMcpElicitationRequestCard
          request={entry.request}
          onRespond={conversationActions.respondMcpElicitation}
        />
      );
    case "permissionRequest":
      return (
        <CodexPermissionRequestCard
          request={entry.request}
          onRespond={conversationActions.respondPermissionRequest}
          onSubmitLocalFollowup={async (prompt) => {
            await actions.onSendPrompt(prompt);
          }}
        />
      );
    case "nodexAgentAuthorization":
      return (
        <NodexAgentAuthorizationRequestCard
          request={entry.request}
          onRespond={conversationActions.respondNodexAgentAuthorization}
        />
      );
    case "optionPicker":
      return (
        <CodexOptionPickerRequestCard
          request={entry.request}
          onRespond={conversationActions.respondOptionPicker}
        />
      );
    case "setupCodexStep":
      return (
        <CodexSetupCodexStepRequestCard
          request={entry.request}
          onRespond={conversationActions.respondSetupCodexStep}
        />
      );
    case "implementPlan":
      const request = entry.request;
      return (
        <CodexImplementPlanRequestCard
          request={request}
          onRespond={async (response) => {
            if (response.type === "implement") {
              await intelligenceController?.flush();
              const selection = intelligenceController?.getSelection();
              if (selection && actions.onIntelligenceSelectionChange) {
                await actions.onIntelligenceSelectionChange(selection, {
                  collaborationMode: "default",
                });
              } else {
                await actions.onCollaborationModeChange("default");
              }
              await actions.onSendPrompt(`${PLAN_IMPLEMENTATION_PROMPT_PREFIX}\n${request.planContent}`, {
                collaborationMode: "default",
                ...(selection ? buildComposerIntelligenceTurnOverrides(selection) : {}),
              });
              return;
            }
            if (response.type === "followUp") {
              await actions.onSendPrompt(response.prompt);
              return;
            }
            await actions.onCollaborationModeChange("default");
            await actions.onResolvePlanImplementationRequest(entry.conversationId, request.turnId);
          }}
        />
      );
  }
}
