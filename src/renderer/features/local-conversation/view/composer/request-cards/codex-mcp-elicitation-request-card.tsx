import { useState } from "react";
import type { CodexMcpServerElicitationRequest } from "../../../../../lib/types";
import { cn } from "../../../../../lib/utils";

interface CodexMcpElicitationRequestCardProps {
  request: CodexMcpServerElicitationRequest;
  onRespond: (requestId: string, action: "accept" | "decline" | "cancel") => Promise<void>;
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      className={cn("icon-2xs transition-transform duration-200", expanded && "rotate-180")}
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M15.2793 7.71101C15.539 7.45131 15.961 7.45131 16.2207 7.71101C16.4804 7.97071 16.4804 8.39272 16.2207 8.65242L10.4707 14.4024C10.211 14.6621 9.78902 14.6621 9.52932 14.4024L3.77932 8.65242L3.69436 8.54792C3.52385 8.28979 3.55205 7.93828 3.77932 7.71101C4.00659 7.48374 4.3581 7.45554 4.61623 7.62605L4.72073 7.71101L10 12.9903L15.2793 7.71101Z"
        fill="currentColor"
      />
    </svg>
  );
}

function CodeBracketsIcon() {
  return (
    <svg viewBox="0 0 21 21" className="icon-sm text-token-text-secondary" fill="none" aria-hidden="true">
      <path
        d="M11.9025 5.3302C12.0658 5.06755 12.3961 4.94629 12.6975 5.05774C13.0419 5.1853 13.2176 5.56881 13.09 5.91321L9.75703 14.9132L9.69745 15.0333C9.53415 15.296 9.20387 15.4172 8.90253 15.3058C8.55813 15.1782 8.3824 14.7947 8.50995 14.4503L11.843 5.45032L11.9025 5.3302ZM5.21894 5.35853C5.3974 5.03773 5.8023 4.92241 6.12324 5.10071C6.44404 5.27917 6.55935 5.68407 6.38105 6.00501L4.05976 10.1818L6.38105 14.3585L6.43476 14.4825C6.52764 14.7774 6.4039 15.1067 6.12324 15.2628C5.84224 15.4189 5.49646 15.3503 5.29511 15.1154L5.21894 15.005L2.71894 10.505C2.60736 10.3042 2.60736 10.0594 2.71894 9.85853L5.21894 5.35853ZM15.4768 5.10071C15.7578 4.9446 16.1035 5.01323 16.3049 5.24817L16.381 5.35853L18.881 9.85853C18.9926 10.0594 18.9926 10.3042 18.881 10.505L16.381 15.005C16.2026 15.3258 15.7977 15.4411 15.4768 15.2628C15.156 15.0844 15.0406 14.6795 15.2189 14.3585L17.5393 10.1818L15.2189 6.00501L15.1652 5.88099C15.0723 5.58611 15.1961 5.25684 15.4768 5.10071Z"
        fill="currentColor"
      />
    </svg>
  );
}

function formatServerName(serverName: string): string {
  const trimmed = serverName.trim();
  return trimmed.length > 0 ? trimmed : "Server";
}

export function CodexMcpElicitationRequestCard({
  request,
  onRespond,
}: CodexMcpElicitationRequestCardProps) {
  const [detailsExpanded, setDetailsExpanded] = useState(true);
  const serverName = formatServerName(request.serverName);
  const detailsText = request.mode === "form"
    ? JSON.stringify(request.requestedSchema ?? {}, null, 2)
    : request.url ?? "";

  return (
    <div className="text-size-chat flex flex-col overflow-hidden rounded-3xl border border-token-border bg-token-input-background text-token-foreground shadow-sm">
      <div className="flex flex-col gap-4 p-4">
        <div className="flex items-center gap-2 text-token-description-foreground">
          <CodeBracketsIcon />
          <span>{serverName}</span>
        </div>
        <div className="text-base leading-tight font-semibold">{request.message}</div>
        {detailsText ? (
          <div className="flex flex-col gap-3">
            <button
              type="button"
              className="flex w-fit items-center gap-1 text-token-description-foreground"
              onClick={() => {
                setDetailsExpanded((current) => !current);
              }}
            >
              <span>Details</span>
              <ChevronIcon expanded={detailsExpanded} />
            </button>
            {detailsExpanded ? (
              <div className="bg-token-text-code-block-background border-token-border/70 overflow-auto rounded-xl border p-3 font-mono text-xs whitespace-pre-wrap text-token-description-foreground">
                {detailsText}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-token-border/70 px-4 py-3">
        <button
          type="button"
          className="inline-flex h-9 items-center rounded-full border border-token-border px-3 text-sm text-token-foreground hover:bg-token-list-hover-background"
          onClick={() => {
            void onRespond(request.requestId, "decline");
          }}
        >
          Cancel
        </button>
        <button
          type="button"
          className="inline-flex h-9 items-center rounded-full bg-token-foreground px-3 text-sm text-token-dropdown-background hover:bg-token-foreground/90"
          onClick={() => {
            if (request.mode === "url" && request.url) {
              window.open(request.url, "_blank", "noopener,noreferrer");
            }
            void onRespond(request.requestId, "accept");
          }}
        >
          {request.mode === "url" ? "Open" : "Approve"}
        </button>
      </div>
    </div>
  );
}
