import type { ReactNode } from "react";

export type ComposerSlashCommandTrigger = "/" | "@";

export interface ComposerSlashTriggerState {
  active: boolean;
  trigger: ComposerSlashCommandTrigger;
  query: string;
  from: number;
  to: number;
}

export interface ComposerSlashCommandSelection {
  source: "inline" | "dialog";
}

export interface ComposerSlashInlineSelection extends ComposerSlashCommandSelection {
  source: "inline";
  trigger: ComposerSlashTriggerState;
  replaceTrigger: (text: string) => void;
  clearTrigger: () => void;
}

export interface ComposerSlashDialogSelection extends ComposerSlashCommandSelection {
  source: "dialog";
}

export interface ComposerSlashCommandContentProps {
  close: () => void;
  back: () => void;
}

export interface ComposerSlashCommand {
  id: string;
  title: string;
  description?: string;
  group: string;
  icon: ReactNode;
  triggers?: readonly ComposerSlashCommandTrigger[];
  requiresEmptyComposer?: boolean;
  isEnabled?: boolean;
  isVisible?: boolean;
  telemetryName?: string;
  Content?: (props: ComposerSlashCommandContentProps) => ReactNode;
  onSelect?: (selection: ComposerSlashCommandSelection) => void | Promise<void>;
  onSelectFromInlineSlash?: (selection: ComposerSlashInlineSelection) => void | Promise<void>;
}

export interface ComposerSlashCommandGroup {
  id: string;
  label: string;
  commands: ComposerSlashCommand[];
}

export type ComposerSlashCommandHighlightSource = "keyboard" | "pointer" | "programmatic";

export interface ComposerSlashCommandMatch {
  command: ComposerSlashCommand;
  score: number;
  matchedTitleIndexes: number[];
}

export interface ComposerSlashMenuViewModel {
  groups: ComposerSlashCommandGroup[];
  matches: ComposerSlashCommandMatch[];
  highlightedCommandId: string | null;
}
