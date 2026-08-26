import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "@/components/shared/icons/generic-icons";
import {
  codeBlockActionButtonClassName,
  codeBlockActionDividerClassName,
  codeBlockActionSurfaceClassName,
} from "@/components/shared/code-block-action-chrome";
import { NodexTooltip } from "@/components/ui/tooltip";
import { writeTextToClipboard } from "@/lib/clipboard";
import { cn } from "@/lib/utils";
import { resolveCodeLanguage } from "../../../shared/nfm/code-language-catalog";

export function CodeBlockReadOnlyHeader({
  languageId,
  code,
}: {
  readonly languageId: string;
  readonly code: string;
}) {
  const [copied, setCopied] = useState(false);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const language = resolveCodeLanguage(languageId);

  useEffect(
    () => () => {
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    },
    [],
  );

  const copy = async () => {
    if (!(await writeTextToClipboard(code))) return;
    setCopied(true);
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    resetTimerRef.current = setTimeout(() => setCopied(false), 1_500);
  };

  return (
    <div
      role="toolbar"
      aria-label="Code block read-only actions"
      data-nfm-code-block-readonly-header
      data-language-id={language.id}
      className={cn(
        "pointer-events-auto flex h-7 max-w-[180px] items-center gap-1 rounded-md px-1.5 text-xs",
        codeBlockActionSurfaceClassName,
      )}
    >
      <span className="min-w-0 max-w-[118px] truncate px-0.5 text-[var(--foreground-secondary)]">
        {language.label}
      </span>
      <span
        aria-hidden="true"
        className={cn("h-4 w-px shrink-0", codeBlockActionDividerClassName)}
      />
      <NodexTooltip tooltipContent={copied ? "Copied" : "Copy code"}>
        <button
          type="button"
          aria-label="Copy code to clipboard"
          className={cn(codeBlockActionButtonClassName, "shrink-0")}
          onClick={() => void copy()}
        >
          {copied ? <Check /> : <Copy />}
        </button>
      </NodexTooltip>
    </div>
  );
}
