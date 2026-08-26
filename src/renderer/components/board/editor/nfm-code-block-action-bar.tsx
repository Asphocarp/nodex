import { useEffect, useRef, useState } from "react";
import { Check, Copy, Ellipsis } from "@/components/shared/icons/generic-icons";
import {
  codeBlockActionButtonClassName,
  codeBlockActionDividerClassName,
  codeBlockActionSurfaceClassName,
} from "@/components/shared/code-block-action-chrome";
import {
  NodexDropdownButtonTrigger,
  NodexOptionPicker,
  type NodexOptionPickerOption,
} from "@/components/ui/dropdown";
import { NodexTooltip } from "@/components/ui/tooltip";
import {
  getCodeLanguageSearchText,
  resolveCodeLanguage,
} from "../../../../shared/nfm/code-language-catalog";
import { searchCodeLanguages, type CodeBlockActionBarMode } from "@/lib/nfm/code-block-model";
import { cn } from "@/lib/utils";

export interface NfmCodeBlockActionBarProps {
  readonly languageId: string;
  readonly mode: CodeBlockActionBarMode;
  readonly onLanguageChange: (languageId: string) => void;
  readonly onCopy: () => Promise<boolean>;
  readonly onMore: (anchor: HTMLButtonElement) => void;
  readonly onInteractionOpenChange?: (open: boolean) => void;
  readonly tooltipsDisabled?: boolean;
}

export function NfmCodeBlockActionBar({
  languageId,
  mode,
  onLanguageChange,
  onCopy,
  onMore,
  onInteractionOpenChange,
  tooltipsDisabled = false,
}: NfmCodeBlockActionBarProps) {
  const [languageOpen, setLanguageOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const language = resolveCodeLanguage(languageId);
  const locale = globalThis.navigator?.language || "en";
  const languages = searchCodeLanguages("", locale);
  const options: readonly NodexOptionPickerOption[] = languages.map((item) => ({
    value: item.id,
    label: item.label,
    searchText: getCodeLanguageSearchText(item),
  }));

  useEffect(
    () => () => {
      if (copyResetTimerRef.current) clearTimeout(copyResetTimerRef.current);
    },
    [],
  );

  const changeLanguageOpen = (open: boolean) => {
    setLanguageOpen(open);
    onInteractionOpenChange?.(open);
  };

  const copyCode = async () => {
    if (!(await onCopy())) return;
    setCopied(true);
    if (copyResetTimerRef.current) clearTimeout(copyResetTimerRef.current);
    copyResetTimerRef.current = setTimeout(() => setCopied(false), 1_500);
  };

  return (
    <div
      role="toolbar"
      aria-label="Code block action bar"
      data-nfm-code-block-action-bar
      className={cn(
        "pointer-events-auto flex h-7 items-center rounded-md p-0.5 text-xs",
        codeBlockActionSurfaceClassName,
      )}
    >
      {mode === "more_only" ? null : (
        <>
          <NodexOptionPicker
            value={language.id}
            options={options}
            search="filter"
            searchPlaceholder="Search languages…"
            searchAriaLabel="Search code languages"
            title="Code language"
            contentWidth="menuWide"
            contentMaxHeight="halfViewport"
            sideOffset={8}
            align="end"
            open={languageOpen}
            onOpenChange={changeLanguageOpen}
            onValueChange={onLanguageChange}
            triggerButton={
              <NodexDropdownButtonTrigger
                aria-label="Open language dropdown"
                size="xs"
                chrome="transparent"
                className="pointer-events-auto max-w-[112px] rounded-[4px] px-1.5 text-[var(--foreground-secondary)]"
              >
                <span className="truncate">{language.label}</span>
              </NodexDropdownButtonTrigger>
            }
          />
          <span
            aria-hidden="true"
            className={cn("mx-0.5 h-4 w-px shrink-0", codeBlockActionDividerClassName)}
          />
          <NodexTooltip
            tooltipContent={copied ? "Copied" : "Copy code"}
            disabled={tooltipsDisabled}
          >
            <button
              type="button"
              aria-label="Copy code to clipboard"
              className={codeBlockActionButtonClassName}
              onClick={() => void copyCode()}
            >
              {copied ? <Check /> : <Copy />}
            </button>
          </NodexTooltip>
        </>
      )}
      <NodexTooltip tooltipContent="Block actions" disabled={tooltipsDisabled}>
        <button
          type="button"
          aria-label="Open block actions menu"
          className={cn(codeBlockActionButtonClassName, mode === "more_only" && "size-6")}
          onClick={(event) => onMore(event.currentTarget)}
        >
          <Ellipsis />
        </button>
      </NodexTooltip>
    </div>
  );
}
