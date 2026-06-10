import { useEffect, useMemo, useState } from "react";
import { SearchIcon } from "lucide-react";
import { groupComposerSlashCommandMatches, filterComposerSlashCommands } from "./slash-command-filter";
import type { ComposerSlashCommand, ComposerSlashCommandHighlightSource } from "./slash-command-types";
import { SlashCommandList } from "./slash-command-list";

interface ExpandedSlashCommandDialogProps {
  open: boolean;
  commands: readonly ComposerSlashCommand[];
  composerText: string;
  highlightedCommandId: string | null;
  highlightedSource: ComposerSlashCommandHighlightSource;
  onHighlight: (commandId: string, source: ComposerSlashCommandHighlightSource) => void;
  onSelect: (command: ComposerSlashCommand) => void;
  onClose: () => void;
}

export function ExpandedSlashCommandDialog({
  open,
  commands,
  composerText,
  highlightedCommandId,
  highlightedSource,
  onHighlight,
  onSelect,
  onClose,
}: ExpandedSlashCommandDialogProps) {
  const [query, setQuery] = useState("");
  const [nestedCommand, setNestedCommand] = useState<ComposerSlashCommand | null>(null);
  const matches = useMemo(() => filterComposerSlashCommands({ commands, query, composerText }), [
    commands,
    composerText,
    query,
  ]);
  const groups = useMemo(() => groupComposerSlashCommandMatches(matches), [matches]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setNestedCommand(null);
    }
  }, [open]);

  if (!open) return null;

  const handleSelect = (command: ComposerSlashCommand) => {
    if (command.Content) {
      setNestedCommand(command);
      return;
    }
    onSelect(command);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-transparent pt-[18vh]" role="presentation">
      <div
        className="flex max-h-[420px] w-[min(42rem,calc(100vw-2rem))] min-h-0 flex-col overflow-hidden rounded-xl bg-token-dropdown-background/95 text-token-foreground shadow-xl-spread ring-[0.5px] ring-token-border/50 backdrop-blur-sm"
        role="dialog"
        aria-label="Slash command menu"
      >
        {nestedCommand?.Content ? (
          <>
            <div className="flex min-h-10 items-center gap-2 border-b border-token-border/50 px-3 text-sm">
              <button
                type="button"
                className="rounded-md px-2 py-1 text-token-description-foreground hover:bg-token-list-hover-background hover:text-token-foreground"
                onClick={() => setNestedCommand(null)}
              >
                Back
              </button>
              <span className="min-w-0 truncate font-medium">{nestedCommand.title}</span>
            </div>
            <div className="vertical-scroll-fade-mask min-h-0 overflow-y-auto p-1">
              {nestedCommand.Content({ close: onClose, back: () => setNestedCommand(null) })}
            </div>
          </>
        ) : (
          <>
            <label className="flex h-11 items-center gap-2 border-b border-token-border/50 px-3 text-sm" aria-label="Search and run slash commands">
              <SearchIcon className="icon-xs shrink-0 text-token-description-foreground" aria-hidden="true" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                autoFocus
                className="min-w-0 flex-1 bg-transparent text-token-foreground outline-none placeholder:text-token-description-foreground"
                placeholder="Search"
                aria-label="Search"
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    onClose();
                  }
                }}
              />
            </label>
            <SlashCommandList
              groups={groups}
              matches={matches}
              highlightedCommandId={highlightedCommandId}
              highlightedSource={highlightedSource}
              onHighlight={onHighlight}
              onSelect={handleSelect}
            />
          </>
        )}
      </div>
    </div>
  );
}
