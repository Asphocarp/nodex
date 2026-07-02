import type {
  CodexPermissionRequest,
  CodexPermissionRequestResponse,
} from "../../../../../lib/types";

interface CodexPermissionRequestCardProps {
  request: CodexPermissionRequest;
  onRespond: (requestId: string, response: CodexPermissionRequestResponse) => Promise<void>;
}

function buildGrantedPermissions(request: CodexPermissionRequest): CodexPermissionRequestResponse["permissions"] {
  return {
    ...(request.permissions.network ? { network: request.permissions.network } : {}),
    ...(request.permissions.fileSystem ? { fileSystem: request.permissions.fileSystem } : {}),
  };
}

function buildDeniedResponse(): CodexPermissionRequestResponse {
  return {
    permissions: {},
    scope: "turn",
  };
}

function buildAllowedResponse(request: CodexPermissionRequest): CodexPermissionRequestResponse {
  return {
    permissions: buildGrantedPermissions(request),
    scope: "turn",
  };
}

function formatReason(reason: string | null): string {
  const normalized = reason?.trim();
  return normalized && normalized.length > 0
    ? normalized
    : "Codex is requesting additional permissions for this turn.";
}

export function CodexPermissionRequestCard({
  request,
  onRespond,
}: CodexPermissionRequestCardProps) {
  return (
    <div className="text-size-chat border-token-border bg-token-input-background/70 flex flex-col overflow-hidden rounded-2xl border text-token-foreground backdrop-blur-sm">
      <div className="flex flex-col gap-3 p-3">
        <div className="text-token-description-foreground">Permission request</div>
        <div className="text-base leading-tight font-medium">{formatReason(request.reason)}</div>
        <div className="bg-token-text-code-block-background border-token-border/70 max-h-48 overflow-auto rounded-lg border p-2 font-mono text-xs whitespace-pre-wrap text-token-description-foreground">
          {JSON.stringify(request.permissions, null, 2)}
        </div>
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-token-border/70 px-3 py-2">
        <button
          type="button"
          className="inline-flex h-token-button-composer items-center rounded-full border border-transparent px-2 text-sm text-token-description-foreground hover:bg-token-list-hover-background hover:text-token-foreground"
          onClick={() => {
            void onRespond(request.requestId, buildDeniedResponse());
          }}
        >
          Deny
        </button>
        <button
          type="button"
          className="inline-flex h-token-button-composer items-center rounded-full bg-token-foreground px-2 text-sm font-medium text-token-dropdown-background hover:bg-token-foreground/80"
          onClick={() => {
            void onRespond(request.requestId, buildAllowedResponse(request));
          }}
        >
          Allow for turn
        </button>
      </div>
    </div>
  );
}
