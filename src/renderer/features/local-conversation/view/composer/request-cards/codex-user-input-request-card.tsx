import type { CodexUserInputRequest } from "../../../../../lib/types";
import {
  RequestComposerView,
  buildUserInputAnswers,
} from "../../shared/request-cards/local-conversation-request-cards";

interface CodexUserInputRequestCardProps {
  request: CodexUserInputRequest;
  onRespond: (requestId: string, answers: Record<string, string[]>) => Promise<void>;
}

export function CodexUserInputRequestCard({
  request,
  onRespond,
}: CodexUserInputRequestCardProps) {
  return (
    <RequestComposerView
      request={request}
      onSubmit={async (nextRequest, state) => {
        await onRespond(nextRequest.requestId, buildUserInputAnswers(nextRequest, state));
      }}
      onEscapeDismiss={async (nextRequest) => {
        await onRespond(nextRequest.requestId, {});
      }}
      submitErrorMessage="Could not submit input request"
      dismissErrorMessage="Could not dismiss input request"
    />
  );
}
