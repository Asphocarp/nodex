import type {
  NodexAgentAuthorizationRequest,
  NodexAgentAuthorizationResponse,
} from "../../../../../lib/types";
import { buildCodexCanonicalRequestIdentityKey } from "../../../../../../shared/codex-conversation-state/codex-conversation-state";
import {
  RequestComposerView,
  type RequestComposerRequest,
} from "../../shared/request-cards/local-conversation-request-cards";

interface NodexAgentAuthorizationRequestCardProps {
  request: NodexAgentAuthorizationRequest;
  onRespond: (
    requestId: string,
    response: NodexAgentAuthorizationResponse,
  ) => Promise<void>;
}

const ALLOW_ONCE = "Allow once";
const ALLOW_TASK = "Allow for this task";
const DENY = "Deny";

function buildComposerRequest(
  request: NodexAgentAuthorizationRequest,
): RequestComposerRequest {
  const questionId = buildCodexCanonicalRequestIdentityKey(request.requestId);
  return {
    requestId: request.requestId,
    questions: [{
      id: questionId,
      header: request.effect === "destructive"
        ? "Allow this destructive Nodex edit?"
        : "Allow Nodex to make this change?",
      question: request.preview.title,
      isOther: false,
      isSecret: false,
      options: [
        {
          label: ALLOW_ONCE,
          description: "Apply only this prepared change.",
        },
        ...(request.effect === "write"
          ? [{
              label: ALLOW_TASK,
              description: "Allow later non-destructive Nodex writes in this task.",
            }]
          : []),
        { label: DENY, description: "Leave Nodex unchanged." },
      ],
    }],
  };
}

function AuthorizationBody({ request }: { request: NodexAgentAuthorizationRequest }) {
  const contentPreview = request.preview.markdownPreview ?? request.preview.nfmPreview;
  return (
    <div className="flex min-w-0 flex-col gap-2 px-4 pb-1 text-sm">
      <div className="text-token-text-secondary">{request.preview.summary}</div>
      {request.preview.details.length > 0 ? (
        <div className="divide-y-[0.5px] divide-token-border rounded-lg bg-token-foreground/5 px-3">
          {request.preview.details.map((detail) => (
            <div
              key={`${detail.label}:${detail.value}`}
              className="grid min-w-0 grid-cols-[6rem_1fr] gap-2 py-2"
            >
              <span className="text-token-description-foreground">{detail.label}</span>
              <span className="wrap-anywhere min-w-0 text-token-foreground">{detail.value}</span>
            </div>
          ))}
        </div>
      ) : null}
      {contentPreview ? (
        <pre className="max-h-40 overflow-auto rounded-lg bg-token-foreground/5 px-3 py-2 text-size-code leading-5 text-token-text-secondary">
          {contentPreview}
        </pre>
      ) : null}
    </div>
  );
}

export function NodexAgentAuthorizationRequestCard({
  request,
  onRespond,
}: NodexAgentAuthorizationRequestCardProps) {
  const composerRequest = buildComposerRequest(request);
  return (
    <RequestComposerView
      header={request.preview.title}
      body={<AuthorizationBody request={request} />}
      showQuestionBodyWhenHeader={false}
      request={composerRequest}
      onSubmit={async (nextRequest, state) => {
        const questionId = nextRequest.questions[0]?.id;
        const selected = questionId ? state.selectedOptions[questionId] : null;
        const decision = selected === ALLOW_ONCE
          ? "allow_once"
          : selected === ALLOW_TASK && request.effect === "write"
            ? "allow_task"
            : "deny";
        await onRespond(request.requestId, { decision });
      }}
      onSkip={async () => {
        await onRespond(request.requestId, { decision: "deny" });
      }}
      onEscapeDismiss={async () => {
        await onRespond(request.requestId, { decision: "deny" });
      }}
      submitErrorMessage="Could not submit Nodex authorization"
      skipErrorMessage="Could not deny Nodex authorization"
      dismissErrorMessage="Could not dismiss Nodex authorization"
    />
  );
}
