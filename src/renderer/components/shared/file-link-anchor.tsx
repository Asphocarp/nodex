import type { MouseEventHandler, ReactNode } from "react";
import { NodexTooltip } from "@/components/ui/tooltip";
import {
  openNfmResolvedLinkAction,
  resolveNfmLinkAction,
  resolveNfmLinkTooltipLabel,
} from "@/lib/nfm-link-actions";
import { useFileLinkOpener } from "@/lib/use-file-link-opener";
import { cn } from "@/lib/utils";

interface FileLinkAnchorProps {
  href?: string;
  className?: string;
  children: ReactNode;
  showLocalFileTooltip?: boolean;
  projectWorkspacePath?: string | null;
}

export function FileLinkAnchor({
  href,
  className,
  children,
  showLocalFileTooltip = false,
  projectWorkspacePath,
}: FileLinkAnchorProps) {
  const { opener } = useFileLinkOpener();
  const action = resolveNfmLinkAction(href, projectWorkspacePath);
  const tooltipLabel = resolveNfmLinkTooltipLabel(action, showLocalFileTooltip);

  const handleClick: MouseEventHandler<HTMLAnchorElement> = (event) => {
    if (!action) return;
    if (action.kind === "local-file") return;

    event.preventDefault();
    event.stopPropagation();

    if (action.kind === "blocked" || action.kind === "unresolved-file-like") {
      return;
    }

    void openNfmResolvedLinkAction(action, opener);
  };

  const anchor = (
    <a
      href={href}
      onClick={handleClick}
      aria-disabled={
        action?.kind === "blocked" || action?.kind === "unresolved-file-like"
          ? true
          : undefined
      }
      className={cn(
        "cursor-interaction inline-block max-w-full appearance-none border-0 bg-transparent p-0 text-left align-baseline whitespace-normal text-token-text-link-foreground hover:underline",
        action?.kind === "blocked" || action?.kind === "unresolved-file-like"
          ? "cursor-not-allowed"
          : "",
        className,
      )}
      target={action?.kind === "literal-anchor" ? undefined : "_blank"}
      rel={action?.kind === "literal-anchor" ? undefined : "noopener noreferrer"}
      title={tooltipLabel ?? undefined}
    >
      <span className="break-words whitespace-normal" data-state="closed">
        {children}
      </span>
    </a>
  );

  if (!tooltipLabel) return anchor;

  return (
    <NodexTooltip
      tooltipContent={tooltipLabel}
      side="top"
      delayDuration={0}
      tooltipBodyClassName="font-mono text-xs leading-4"
    >
      {anchor}
    </NodexTooltip>
  );
}
