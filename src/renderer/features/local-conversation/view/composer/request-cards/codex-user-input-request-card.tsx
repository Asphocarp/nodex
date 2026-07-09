import type {
  CodexProtocolRequestId,
  CodexUserInputRequest,
} from "../../../../../lib/types";
import {
  RequestComposerView,
  buildUserInputAnswers,
} from "../../shared/request-cards/local-conversation-request-cards";

interface CodexUserInputRequestCardProps {
  request: CodexUserInputRequest;
  onRespond: (requestId: CodexProtocolRequestId, answers: Record<string, string[]>) => Promise<void>;
  onInterrupt?: () => Promise<void>;
}

export function CodexUserInputRequestCard({
  request,
  onRespond,
  onInterrupt,
}: CodexUserInputRequestCardProps) {
  const viewRequest = request.isOnboardingDynamicInput
    ? {
        ...request,
        questions: request.questions.map((question) => ({
          ...question,
          isOther: true,
          otherPlaceholder: "Something else",
        })),
      }
    : request;

  return (
    <RequestComposerView
      request={viewRequest}
      onSubmit={async (nextRequest, state) => {
        await onRespond(nextRequest.requestId, buildUserInputAnswers(nextRequest, state));
      }}
      onEscapeDismiss={async (nextRequest) => {
        if (request.isOnboardingDynamicInput || request.autoResolutionMs != null) {
          await onRespond(nextRequest.requestId, {});
          return;
        }
        await onInterrupt?.();
      }}
      submitErrorMessage="Could not submit input request"
      dismissErrorMessage="Could not dismiss input request"
    />
  );
}
