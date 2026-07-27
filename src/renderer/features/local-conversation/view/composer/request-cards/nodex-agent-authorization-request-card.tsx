import type {
  NodexAgentAuthorizationRequest,
  NodexAgentAuthorizationResponse,
} from "../../../../../lib/types";
import { buildCodexCanonicalRequestIdentityKey } from "../../../../../../shared/codex-conversation-state/codex-conversation-state";
import {
  EXPLICIT_REQUEST_FORM_POLICY,
  RequestComposerView,
  getRequestQuestionnaireAnswer,
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
const ALLOW_PROJECT = "Allow for this project";
const DENY = "Deny";

function buildComposerRequest(
  request: NodexAgentAuthorizationRequest,
): RequestComposerRequest {
  const questionId = buildCodexCanonicalRequestIdentityKey(request.requestId);
  return {
    requestId: request.requestId,
    questions: [{
      id: questionId,
      header: request.effect === "read"
        ? "Allow Nodex to access this resource?"
        : request.effect === "destructive"
          ? "Allow this destructive Nodex edit?"
          : "Allow Nodex to make this change?",
      question: request.preview.title,
      isOther: false,
      isSecret: false,
      options: [
        {
          label: ALLOW_ONCE,
          description: request.effect === "read"
            ? "Allow only this prepared access."
            : "Apply only this prepared change.",
        },
        {
          label: ALLOW_TASK,
          description: "Allow this task to use the same resource with this level of access.",
        },
        {
          label: ALLOW_PROJECT,
          description: "Grant this Project persistent access to the resource.",
        },
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
      policy={EXPLICIT_REQUEST_FORM_POLICY}
      onSubmit={async (nextRequest, state) => {
        const questionId = nextRequest.questions[0]?.id;
        const selected = questionId
          ? getRequestQuestionnaireAnswer(nextRequest, state, questionId)
            ?.selectedOptionId
          : null;
        const decision = selected === ALLOW_ONCE
          ? "allow_once"
          : selected === ALLOW_TASK
            ? "allow_task"
            : selected === ALLOW_PROJECT
              ? "allow_project"
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
