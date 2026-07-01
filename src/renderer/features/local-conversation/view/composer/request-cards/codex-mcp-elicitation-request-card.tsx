import { useState } from "react";
import { ChevronDownIcon } from "@/components/shared/icons";
import type { CodexMcpServerElicitationRequest } from "../../../../../lib/types";
import { cn } from "../../../../../lib/utils";
import {
  ToolActivityIcon,
  resolveMcpElicitationIcon,
} from "../../shared/tools/tool-call-icons";

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
  const detailsText = request.mode === "url"
    ? request.url ?? ""
    : JSON.stringify(request.requestedSchema ?? {}, null, 2);

  return (
    <div className="text-size-chat border-token-border bg-token-input-background/70 flex flex-col overflow-hidden rounded-2xl border text-token-foreground backdrop-blur-sm">
      <div className="flex flex-col gap-3 p-3">
        <div className="flex items-center gap-2 text-token-description-foreground">
          <ToolActivityIcon descriptor={resolveMcpElicitationIcon(request)} className="icon-sm text-token-text-secondary" />
          <span>{serverName}</span>
        </div>
        <div className="text-base leading-tight font-medium">{request.message}</div>
        {detailsText ? (
          <div className="flex flex-col gap-2">
            <button
              type="button"
              className="flex w-fit items-center gap-1 rounded-full px-1 text-token-description-foreground hover:bg-token-list-hover-background hover:text-token-foreground"
              onClick={() => {
                setDetailsExpanded((current) => !current);
              }}
            >
              <span>Details</span>
              <ChevronDownIcon className={cn("transition-transform duration-200", detailsExpanded && "rotate-180")} />
            </button>
            {detailsExpanded ? (
              <div className="bg-token-text-code-block-background border-token-border/70 max-h-48 overflow-auto rounded-lg border p-2 font-mono text-xs whitespace-pre-wrap text-token-description-foreground">
                {detailsText}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-token-border/70 px-3 py-2">
        <button
          type="button"
          className="inline-flex h-token-button-composer items-center rounded-full border border-transparent px-2 text-sm text-token-description-foreground hover:bg-token-list-hover-background hover:text-token-foreground"
          onClick={() => {
            void onRespond(request.requestId, "decline");
          }}
        >
          Cancel
        </button>
        <button
          type="button"
          className="inline-flex h-token-button-composer items-center rounded-full bg-token-foreground px-2 text-sm font-medium text-token-dropdown-background hover:bg-token-foreground/80"
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
