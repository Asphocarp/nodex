import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import type {
  ComposerSlashCommand,
  ComposerSlashCommandGroup,
  ComposerSlashCommandHighlightSource,
  ComposerSlashCommandMatch,
} from "./slash-command-types";

interface SlashCommandListProps {
  groups: ComposerSlashCommandGroup[];
  matches: readonly ComposerSlashCommandMatch[];
  highlightedCommandId: string | null;
  highlightedSource: ComposerSlashCommandHighlightSource;
  onHighlight: (commandId: string, source: ComposerSlashCommandHighlightSource) => void;
  onSelect: (command: ComposerSlashCommand) => void;
}

export function SlashCommandList({
  groups,
  matches,
  highlightedCommandId,
  highlightedSource,
  onHighlight,
  onSelect,
}: SlashCommandListProps) {
  if (matches.length === 0) {
    return (
      <div className="px-2 py-row-y text-sm text-token-description-foreground">
        No commands
      </div>
    );
  }

  const showGroupLabels = groups.length > 1;

  return (
    <div
      className={cn(
        "vertical-scroll-fade-mask flex w-full flex-1 flex-col overflow-y-auto",
        showGroupLabels && "scroll-pt-7",
      )}
    >
      {groups.map((group) => (
        <SlashCommandGroup
          key={group.id}
          group={group}
          showLabel={showGroupLabels}
          highlightedCommandId={highlightedCommandId}
          highlightedSource={highlightedSource}
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
  highlightedSource,
  onHighlight,
  onSelect,
}: {
  group: ComposerSlashCommandGroup;
  showLabel: boolean;
  highlightedCommandId: string | null;
  highlightedSource: ComposerSlashCommandHighlightSource;
  onHighlight: (commandId: string, source: ComposerSlashCommandHighlightSource) => void;
  onSelect: (command: ComposerSlashCommand) => void;
}) {
  return (
    <div className="flex flex-col">
      {showLabel ? (
        <div className="block px-2 pt-2 text-sm text-token-description-foreground">
          {group.label}
        </div>
      ) : null}
      {group.commands.map((command) => (
        <SlashCommandRow
          key={command.id}
          command={command}
          selected={command.id === highlightedCommandId}
          shouldScrollIntoView={highlightedSource !== "pointer"}
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
  shouldScrollIntoView,
  onHighlight,
  onSelect,
}: {
  command: ComposerSlashCommand;
  selected: boolean;
  shouldScrollIntoView: boolean;
  onHighlight: (commandId: string, source: ComposerSlashCommandHighlightSource) => void;
  onSelect: (command: ComposerSlashCommand) => void;
}) {
  const rowRef = useRef<HTMLButtonElement | null>(null);
  const disabled = command.isEnabled === false;
  const rowClassName = [
    "text-token-foreground outline-hidden opacity-75 focus:bg-token-list-hover-background cursor-interaction w-full shrink-0 overflow-hidden rounded-lg px-row-x py-row-y text-left text-sm",
    "disabled:cursor-not-allowed disabled:opacity-45",
    selected ? "bg-token-list-hover-background opacity-100" : "hover:bg-token-list-hover-background hover:opacity-100",
  ].join(" ");

  useEffect(() => {
    if (!selected) return;
    if (!shouldScrollIntoView) return;
    rowRef.current?.scrollIntoView({ block: "nearest" });
  }, [selected, shouldScrollIntoView]);

  return (
    <button
      ref={rowRef}
      type="button"
      aria-selected={selected}
      disabled={disabled}
      data-list-navigation-item="true"
      data-slash-command-row={command.id}
      className={rowClassName}
      onMouseEnter={() => onHighlight(command.id, "pointer")}
      onClick={() => {
        if (disabled) return;
        onSelect(command);
      }}
    >
      <div className="flex w-full items-center gap-2">
        {command.icon}
        <div
          className={cn(
            command.description
              ? "max-w-[60%] flex-none truncate"
              : "min-w-0 flex-1 truncate",
          )}
        >
          {command.title}
        </div>
        {command.description ? (
          <span className="min-w-0 flex-1 truncate text-sm text-token-description-foreground">
            {command.description}
          </span>
        ) : null}
      </div>
    </button>
  );
}
