import type { CodexPlanImplementationRequest } from "../../../../../lib/types";
import {
  RequestComposerView,
  buildUserInputAnswers,
  type RequestComposerRequest,
} from "../../shared/request-cards/local-conversation-request-cards";
import { buildCodexCanonicalRequestIdentityKey } from "../../../../../../shared/codex-conversation-state/codex-conversation-state";

interface CodexImplementPlanRequestCardProps {
  request: CodexPlanImplementationRequest;
  onRespond: (response: { type: "dismiss" } | { type: "implement" } | { type: "followUp"; prompt: string }) => Promise<void>;
}

function buildPlanComposerRequest(request: CodexPlanImplementationRequest): RequestComposerRequest {
  const questionId = buildCodexCanonicalRequestIdentityKey(request.requestId);
  return {
    requestId: request.requestId,
    questions: [{
      id: questionId,
      header: "Implement this plan?",
      question: "Implement this plan?",
      isOther: true,
      isSecret: false,
      otherPlaceholder: "No, and tell Codex what to do differently",
      options: [{ label: "Yes, implement this plan", description: "" }],
    }],
  };
}

export function CodexImplementPlanRequestCard({
  request,
  onRespond,
}: CodexImplementPlanRequestCardProps) {
  const composerRequest = buildPlanComposerRequest(request);

  return (
    <RequestComposerView
      request={composerRequest}
      onSubmit={async (nextRequest, state) => {
        const questionId = nextRequest.questions[0]?.id;
        const answer = questionId
          ? buildUserInputAnswers(nextRequest, state)[questionId]?.[0]?.trim() ?? ""
          : "";
        if (!answer) return;
        if (answer === "Yes, implement this plan") {
          await onRespond({ type: "implement" });
          return;
        }
        await onRespond({ type: "followUp", prompt: answer });
      }}
      onEscapeDismiss={async () => {
        await onRespond({ type: "dismiss" });
      }}
      submitErrorMessage="Could not submit plan implementation request"
      dismissErrorMessage="Could not dismiss plan implementation request"
    />
  );
}
