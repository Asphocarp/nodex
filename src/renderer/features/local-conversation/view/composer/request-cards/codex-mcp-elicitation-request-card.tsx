import { useState } from "react";
import { ChevronDownIcon, CodeBracketsIcon } from "@/components/shared/icons";
import type { CodexMcpServerElicitationRequest } from "../../../../../lib/types";
import { cn } from "../../../../../lib/utils";

interface CodexMcpElicitationRequestCardProps {
  request: CodexMcpServerElicitationRequest;
  onRespond: (requestId: string, action: "accept" | "decline" | "cancel") => Promise<void>;
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
          <CodeBracketsIcon className="icon-sm text-token-text-secondary" />
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
              <ChevronDownIcon className={cn("transition-transform duration-200", detailsExpanded && "rotate-180")} />
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
