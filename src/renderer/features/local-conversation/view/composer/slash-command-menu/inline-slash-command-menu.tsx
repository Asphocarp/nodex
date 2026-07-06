import { useEffect } from "react";
import { cn } from "@/lib/utils";
import type {
  ComposerSlashCommand,
  ComposerSlashCommandGroup,
  ComposerSlashCommandHighlightSource,
  ComposerSlashCommandMatch,
} from "./slash-command-types";
import { SlashCommandList } from "./slash-command-list";

interface InlineSlashCommandMenuProps {
  open: boolean;
  groups: ComposerSlashCommandGroup[];
  matches: readonly ComposerSlashCommandMatch[];
  highlightedCommandId: string | null;
  highlightedSource: ComposerSlashCommandHighlightSource;
  nestedCommand: ComposerSlashCommand | null;
  onHighlight: (commandId: string, source: ComposerSlashCommandHighlightSource) => void;
  onSelect: (command: ComposerSlashCommand) => void;
  onClose: () => void;
  onBack: () => void;
}

export function InlineSlashCommandMenu({
  open,
  groups,
  matches,
  highlightedCommandId,
  highlightedSource,
  nestedCommand,
  onHighlight,
  onSelect,
  onClose,
  onBack,
}: InlineSlashCommandMenuProps) {
  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest("[data-slash-command-menu='true']")) return;
      if (target.closest("[data-composer-prompt-frame='true']")) return;
      onClose();
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => document.removeEventListener("pointerdown", handlePointerDown, true);
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div
      data-composer-overlay-floating-ui="true"
      className="absolute left-0 right-0 bottom-full z-50 mb-2"
    >
      <div
        data-slash-command-menu="true"
        className={cn(
          "border-token-border bg-token-dropdown-background/90 relative flex w-full flex-col overflow-hidden rounded-2xl border p-1 text-sm font-[445] text-token-foreground backdrop-blur-sm max-h-[320px]",
        )}
      >
        {nestedCommand?.Content ? (
          <div className="flex min-h-0 flex-col">
            <div className="flex h-[30px] shrink-0 items-center gap-2 rounded-lg px-row-x py-row-y text-sm">
              <button
                type="button"
                className="text-token-foreground outline-hidden opacity-75 focus:bg-token-list-hover-background cursor-interaction shrink-0 overflow-hidden rounded-lg px-row-x py-row-y text-left text-sm hover:bg-token-list-hover-background hover:opacity-100"
                onClick={onBack}
              >
                Back
              </button>
              <span className="min-w-0 truncate">{nestedCommand.title}</span>
            </div>
            <div className="vertical-scroll-fade-mask flex w-full flex-1 flex-col overflow-y-auto">
              {nestedCommand.Content({ close: onClose, back: onBack })}
            </div>
          </div>
        ) : (
          <SlashCommandList
            groups={groups}
            matches={matches}
            highlightedCommandId={highlightedCommandId}
            highlightedSource={highlightedSource}
            onHighlight={onHighlight}
            onSelect={onSelect}
          />
        )}
      </div>
    </div>
  );
}
