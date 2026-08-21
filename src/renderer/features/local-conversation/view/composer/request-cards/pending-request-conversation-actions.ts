import type { ThreadStageActions } from "../../../thread-stage-types";

type ApprovalResponse = Parameters<ThreadStageActions["onRespondApproval"]>[1];
type ApprovalRequestId = Parameters<ThreadStageActions["onRespondApproval"]>[0];
type UserInputAnswers = Parameters<ThreadStageActions["onRespondUserInput"]>[1];
type UserInputRequestId = Parameters<ThreadStageActions["onRespondUserInput"]>[0];
type McpElicitationAction = Parameters<ThreadStageActions["onRespondMcpElicitation"]>[1];
type McpElicitationRequestId = Parameters<ThreadStageActions["onRespondMcpElicitation"]>[0];
type PermissionResponse = Parameters<
  NonNullable<ThreadStageActions["onRespondPermissionRequest"]>
>[1];
type PermissionRequestId = Parameters<
  NonNullable<ThreadStageActions["onRespondPermissionRequest"]>
>[0];
type NodexAuthorizationResponse = Parameters<
  NonNullable<ThreadStageActions["onRespondNodexAgentAuthorization"]>
>[1];
type NodexAuthorizationRequestId = Parameters<
  NonNullable<ThreadStageActions["onRespondNodexAgentAuthorization"]>
>[0];
type OptionPickerResponse = Parameters<NonNullable<ThreadStageActions["onRespondOptionPicker"]>>[1];
type OptionPickerRequestId = Parameters<
  NonNullable<ThreadStageActions["onRespondOptionPicker"]>
>[0];
type SetupCodexStepResponse = Parameters<
  NonNullable<ThreadStageActions["onRespondSetupCodexStep"]>
>[1];
type SetupCodexStepRequestId = Parameters<
  NonNullable<ThreadStageActions["onRespondSetupCodexStep"]>
>[0];

interface BindPendingRequestConversationActionsInput {
  actions: ThreadStageActions;
  conversationId: string;
  onManualApproval?: (conversationId: string) => void | Promise<void>;
}

/** Owns the conversation-scoped transport context shared by direct request cards. */
export function bindPendingRequestConversationActions({
  actions,
  conversationId,
  onManualApproval,
}: BindPendingRequestConversationActionsInput) {
  const context = { conversationId };

  return {
    respondApproval: async (requestId: ApprovalRequestId, response: ApprovalResponse) => {
      await actions.onRespondApproval(requestId, response, context);
      if (response.decision === "decline" || response.decision === "cancel") return;
      await onManualApproval?.(conversationId);
    },
    respondUserInput: async (requestId: UserInputRequestId, answers: UserInputAnswers) => {
      await actions.onRespondUserInput(requestId, answers, context);
    },
    respondMcpElicitation: async (
      requestId: McpElicitationRequestId,
      action: McpElicitationAction,
    ) => {
      await actions.onRespondMcpElicitation(requestId, action, context);
    },
    respondPermissionRequest: async (
      requestId: PermissionRequestId,
      response: PermissionResponse,
    ) => {
      await actions.onRespondPermissionRequest?.(requestId, response, context);
      await onManualApproval?.(conversationId);
    },
    respondNodexAgentAuthorization: async (
      requestId: NodexAuthorizationRequestId,
      response: NodexAuthorizationResponse,
    ) => {
      await actions.onRespondNodexAgentAuthorization?.(requestId, response, context);
    },
    respondOptionPicker: async (
      requestId: OptionPickerRequestId,
      response: OptionPickerResponse,
    ) => {
      await actions.onRespondOptionPicker?.(requestId, response, context);
    },
    respondSetupCodexStep: async (
      requestId: SetupCodexStepRequestId,
      response: SetupCodexStepResponse,
    ) => {
      await actions.onRespondSetupCodexStep?.(requestId, response, context);
    },
  };
}
