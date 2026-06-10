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
      data-slash-command-menu="true"
      className={cn(
        "absolute inset-x-0 bottom-[calc(100%+0.375rem)] z-50 flex max-h-[320px] min-h-0 flex-col overflow-hidden rounded-xl bg-token-dropdown-background/90 text-token-foreground shadow-xl-spread ring-[0.5px] ring-token-border/50 backdrop-blur-sm",
      )}
      role="dialog"
      aria-label="Slash command menu"
    >
      {nestedCommand?.Content ? (
        <div className="flex min-h-0 flex-col">
          <div className="flex min-h-9 items-center gap-2 border-b border-token-border/50 px-3 py-1.5 text-sm">
            <button
              type="button"
              className="rounded-md px-2 py-1 text-token-description-foreground hover:bg-token-list-hover-background hover:text-token-foreground"
              onClick={onBack}
            >
              Back
            </button>
            <span className="min-w-0 truncate font-medium">{nestedCommand.title}</span>
          </div>
          <div className="vertical-scroll-fade-mask min-h-0 overflow-y-auto p-1">
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
  );
}
