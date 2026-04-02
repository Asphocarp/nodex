import { parseLocalFileLinkHref } from "../../../shared/file-link-openers";
import type { ReactNode } from "react";
import { NodexTooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface FileLinkAnchorProps {
  href?: string;
  className?: string;
  children: ReactNode;
  showLocalFileTooltip?: boolean;
}

function resolveLocalFileTooltipLabel(href?: string): string | null {
  if (!href) return null;

  const target = parseLocalFileLinkHref(href);
  if (!target) return null;
  if (!target.line) return target.path;
  if (!target.column) return `${target.path} (line ${target.line})`;

  return `${target.path} (line ${target.line}, column ${target.column})`;
}

export function FileLinkAnchor({
  href,
  className,
  children,
  showLocalFileTooltip = false,
}: FileLinkAnchorProps) {
  const tooltipLabel = showLocalFileTooltip
    ? resolveLocalFileTooltipLabel(href)
    : null;

  const anchor = (
    <a
      href={href}
      className={cn(
        "cursor-interaction inline-block max-w-full appearance-none border-0 bg-transparent p-0 text-left align-baseline whitespace-normal text-token-text-link-foreground hover:underline",
        className,
      )}
      target="_blank"
      rel="noopener noreferrer"
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
