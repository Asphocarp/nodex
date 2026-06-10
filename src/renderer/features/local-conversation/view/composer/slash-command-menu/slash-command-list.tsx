import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import type {
  ComposerSlashCommand,
  ComposerSlashCommandGroup,
  ComposerSlashCommandMatch,
} from "./slash-command-types";

interface SlashCommandListProps {
  groups: ComposerSlashCommandGroup[];
  matches: readonly ComposerSlashCommandMatch[];
  highlightedCommandId: string | null;
  onHighlight: (commandId: string) => void;
  onSelect: (command: ComposerSlashCommand) => void;
}

export function SlashCommandList({
  groups,
  matches,
  highlightedCommandId,
  onHighlight,
  onSelect,
}: SlashCommandListProps) {
  if (matches.length === 0) {
    return (
      <div className="px-3 py-2 text-sm text-token-description-foreground">
        No commands
      </div>
    );
  }

  const showGroupLabels = groups.length > 1;

  return (
    <div
      className={cn(
        "vertical-scroll-fade-mask flex min-h-0 flex-1 flex-col overflow-y-auto py-1",
        showGroupLabels && "scroll-pt-7",
      )}
      role="listbox"
      aria-label="Slash commands"
    >
      {groups.map((group) => (
        <SlashCommandGroup
          key={group.id}
          group={group}
          showLabel={showGroupLabels}
          highlightedCommandId={highlightedCommandId}
          onHighlight={onHighlight}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

function SlashCommandGroup({
  group,
  showLabel,
  highlightedCommandId,
  onHighlight,
  onSelect,
}: {
  group: ComposerSlashCommandGroup;
  showLabel: boolean;
  highlightedCommandId: string | null;
  onHighlight: (commandId: string) => void;
  onSelect: (command: ComposerSlashCommand) => void;
}) {
  return (
    <div className="relative flex flex-col" role="group" aria-label={group.label}>
      {showLabel ? (
        <div className="sticky top-0 z-10 bg-token-dropdown-background/95 px-3 py-1 text-sm text-token-description-foreground backdrop-blur-sm">
          {group.label}
        </div>
      ) : null}
      {group.commands.map((command) => (
        <SlashCommandRow
          key={command.id}
          command={command}
          selected={command.id === highlightedCommandId}
          onHighlight={onHighlight}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

function SlashCommandRow({
  command,
  selected,
  onHighlight,
  onSelect,
}: {
  command: ComposerSlashCommand;
  selected: boolean;
  onHighlight: (commandId: string) => void;
  onSelect: (command: ComposerSlashCommand) => void;
}) {
  const rowRef = useRef<HTMLButtonElement | null>(null);
  const disabled = command.isEnabled === false;

  useEffect(() => {
    if (!selected) return;
    rowRef.current?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  return (
    <button
      ref={rowRef}
      type="button"
      role="option"
      aria-selected={selected}
      disabled={disabled}
      data-slash-command-row={command.id}
      className={cn(
        "mx-1 flex min-h-9 w-[calc(100%-0.5rem)] items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-token-foreground outline-none transition-colors",
        "disabled:cursor-not-allowed disabled:opacity-45",
        selected ? "bg-token-list-hover-background" : "hover:bg-token-list-hover-background",
      )}
      onMouseEnter={() => onHighlight(command.id)}
      onClick={() => {
        if (disabled) return;
        onSelect(command);
      }}
    >
      <span className="icon-xs shrink-0 text-token-description-foreground">
        {command.icon}
      </span>
      <span
        className={cn(
          "truncate",
          command.description ? "max-w-[60%] flex-none" : "min-w-0 flex-1",
        )}
      >
        {command.title}
      </span>
      {command.description ? (
        <span className="min-w-0 flex-1 truncate text-sm text-token-description-foreground">
          {command.description}
        </span>
      ) : null}
    </button>
  );
}
