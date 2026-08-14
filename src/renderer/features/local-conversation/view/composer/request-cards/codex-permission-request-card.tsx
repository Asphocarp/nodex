import type {
  CodexThreadDetailLevel,
  CodexPermissionRequest,
  CodexPermissionRequestResponse,
  CodexProtocolRequestId,
} from "../../../../../lib/types";
import type { ReactNode } from "react";
import { resolveCodexThreadDetailLevel } from "../../../../../lib/codex-thread-settings";
import { useCodexThreadSettings } from "../../../../../lib/use-codex-thread-settings";
import {
  EXPLICIT_REQUEST_FORM_POLICY,
  RequestComposerView,
  getRequestQuestionnaireAnswer,
  type RequestComposerRequest,
} from "../../shared/request-cards/local-conversation-request-cards";
import {
  buildCodexGrantedPermissionProfile,
  buildCodexPermissionRequestDetails,
  formatCodexPermissionAccessLabel,
  resolveCodexPermissionRequestTitleModel,
  type CodexPermissionRequestDetail,
  type CodexPermissionRequestFileSystemAccess,
  type CodexPermissionRequestTitleModel,
} from "../../../../../../shared/codex-permission-request";
import { buildCodexCanonicalRequestIdentityKey } from "../../../../../../shared/codex-conversation-state/codex-conversation-state";

interface CodexPermissionRequestCardProps {
  request: CodexPermissionRequest;
  onRespond: (requestId: CodexProtocolRequestId, response: CodexPermissionRequestResponse) => Promise<void>;
  onSubmitLocalFollowup?: (prompt: string) => Promise<void>;
}

const ALLOW_ONCE_LABEL = "Yes, allow for this turn";
const ALLOW_FOR_SESSION_LABEL = "Yes, allow for this session";

function buildDeniedResponse(): CodexPermissionRequestResponse {
  return {
    permissions: {},
    scope: "turn",
  };
}

function buildAllowedResponse(request: CodexPermissionRequest): CodexPermissionRequestResponse {
  return {
    permissions: buildCodexGrantedPermissionProfile(request.permissions),
    scope: "turn",
  };
}

function buildAllowedForSessionResponse(request: CodexPermissionRequest): CodexPermissionRequestResponse {
  return {
    permissions: buildCodexGrantedPermissionProfile(request.permissions),
    scope: "session",
  };
}

function shouldShowAllowForSessionOption(threadDetailLevel: CodexThreadDetailLevel): boolean {
  return threadDetailLevel !== "STEPS_PROSE";
}

function buildPermissionComposerRequest(
  request: CodexPermissionRequest,
  titleModel: CodexPermissionRequestTitleModel,
  threadDetailLevel: CodexThreadDetailLevel,
): RequestComposerRequest {
  const title = formatPermissionTitleText(titleModel);
  const questionId = buildCodexCanonicalRequestIdentityKey(request.requestId);
  const options = [
    {
      label: ALLOW_ONCE_LABEL,
      description: "",
    },
    ...(shouldShowAllowForSessionOption(threadDetailLevel)
      ? [{
          label: ALLOW_FOR_SESSION_LABEL,
          description: "",
        }]
      : []),
  ];

  return {
    requestId: request.requestId,
    questions: [{
      id: questionId,
      header: title,
      question: title,
      isOther: true,
      isSecret: false,
      otherPlaceholder: "No, and tell Nodex what to do differently",
      options,
    }],
  };
}

function formatPermissionTitleText(titleModel: CodexPermissionRequestTitleModel): string {
  if (titleModel.kind === "network") return "Allow network access?";
  if (titleModel.kind === "additional") return "Allow additional access?";

  if (titleModel.access === "read") return `Allow read access to ${titleModel.path}?`;
  if (titleModel.access === "write") return `Allow write access to ${titleModel.path}?`;
  return `Allow read and write access to ${titleModel.path}?`;
}

function PermissionTitle({ titleModel }: { titleModel: CodexPermissionRequestTitleModel }) {
  if (titleModel.kind === "network") return "Allow network access?";
  if (titleModel.kind === "additional") return "Allow additional access?";

  const path = (
    <span className="font-mono wrap-anywhere text-token-description-foreground" title={titleModel.path}>
      {titleModel.path}
    </span>
  );

  if (titleModel.access === "read") return <>Allow read access to {path}?</>;
  if (titleModel.access === "write") return <>Allow write access to {path}?</>;
  return <>Allow read and write access to {path}?</>;
}

function LabeledPermissionDetail({
  label,
  children,
}: {
  label: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="grid min-w-0 grid-cols-[minmax(6rem,auto)_1fr] gap-3">
      <div className="text-token-description-foreground">{label}</div>
      <div className="min-w-0 text-token-foreground">{children}</div>
    </div>
  );
}

function PermissionPathList({ paths }: { paths: string[] }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      {paths.map((path) => (
        <div key={path} className="text-size-code font-mono leading-5 text-token-description-foreground">
          {path}
        </div>
      ))}
    </div>
  );
}

function FileSystemPermissionDetail({
  access,
  paths,
}: {
  access: CodexPermissionRequestFileSystemAccess;
  paths: string[];
}) {
  return (
    <LabeledPermissionDetail label={formatCodexPermissionAccessLabel(access)}>
      <PermissionPathList paths={paths} />
    </LabeledPermissionDetail>
  );
}

function PermissionDetail({ detail }: { detail: CodexPermissionRequestDetail }) {
  if (detail.kind === "network") {
    return (
      <LabeledPermissionDetail label="Network">
        Internet access
      </LabeledPermissionDetail>
    );
  }

  return <FileSystemPermissionDetail access={detail.access} paths={detail.paths} />;
}

function PermissionBody({
  details,
  reason,
}: {
  details: CodexPermissionRequestDetail[];
  reason: string | null;
}) {
  const normalizedReason = reason?.trim() ?? "";
  if (normalizedReason.length === 0 && details.length === 0) return null;

  return (
    <div className="flex flex-col gap-1 px-4 pb-1 text-sm">
      {normalizedReason ? (
        <LabeledPermissionDetail label="Reason">
          {normalizedReason}
        </LabeledPermissionDetail>
      ) : null}
      {details.map((detail) => (
        <PermissionDetail key={JSON.stringify(detail)} detail={detail} />
      ))}
    </div>
  );
}

export function CodexPermissionRequestCard({
  request,
  onRespond,
  onSubmitLocalFollowup,
}: CodexPermissionRequestCardProps) {
  const { settings } = useCodexThreadSettings();
  const threadDetailLevel = resolveCodexThreadDetailLevel(settings.detailLevel);
  const details = buildCodexPermissionRequestDetails(request.permissions);
  const titleModel = resolveCodexPermissionRequestTitleModel(details);
  const composerRequest = buildPermissionComposerRequest(request, titleModel, threadDetailLevel);

  return (
    <RequestComposerView
      header={<PermissionTitle titleModel={titleModel} />}
      body={<PermissionBody details={details} reason={request.reason} />}
      showQuestionBodyWhenHeader={false}
      request={composerRequest}
      policy={EXPLICIT_REQUEST_FORM_POLICY}
      onSubmit={async (nextRequest, state) => {
        const questionId = nextRequest.questions[0]?.id;
        if (!questionId) {
          await onRespond(request.requestId, buildDeniedResponse());
          return;
        }
        const answer = getRequestQuestionnaireAnswer(
          nextRequest,
          state,
          questionId,
        );
        const selected = answer?.selectedOptionId;
        const freeform = answer?.freeformText?.trim() ?? "";

        if (selected === null) {
          await onRespond(request.requestId, buildDeniedResponse());
          if (freeform && onSubmitLocalFollowup) {
            await onSubmitLocalFollowup(freeform);
          }
          return;
        }

        if (selected === ALLOW_FOR_SESSION_LABEL) {
          await onRespond(request.requestId, buildAllowedForSessionResponse(request));
          return;
        }

        if (selected === ALLOW_ONCE_LABEL) {
          await onRespond(request.requestId, buildAllowedResponse(request));
          return;
        }

        await onRespond(request.requestId, buildDeniedResponse());
      }}
      onSkip={async () => {
        await onRespond(request.requestId, buildDeniedResponse());
      }}
      onEscapeDismiss={async () => {
        await onRespond(request.requestId, buildDeniedResponse());
      }}
      submitErrorMessage="Could not submit permission request"
      skipErrorMessage="Could not skip permission request"
      dismissErrorMessage="Could not dismiss permission request"
    />
  );
}
