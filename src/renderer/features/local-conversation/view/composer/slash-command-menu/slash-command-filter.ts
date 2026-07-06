import type {
  ComposerSlashCommand,
  ComposerSlashCommandGroup,
  ComposerSlashCommandTrigger,
  ComposerSlashCommandMatch,
  ComposerSlashTriggerState,
} from "./slash-command-types";

export interface ComposerSlashTriggerInput {
  text: string;
  cursor: number;
}

export function detectComposerSlashTrigger(input: ComposerSlashTriggerInput): ComposerSlashTriggerState {
  const cursor = Math.max(0, Math.min(input.cursor, input.text.length));
  const beforeCursor = input.text.slice(0, cursor);
  const tokenMatch = /(?:^|\s)([/@])([^\s/@]*)$/u.exec(beforeCursor);

  if (!tokenMatch || tokenMatch.index < 0) {
    return inactiveSlashTrigger(cursor);
  }

  const trigger = tokenMatch[1] as ComposerSlashCommandTrigger;
  const triggerOffsetWithinMatch = tokenMatch[0].lastIndexOf(trigger);
  const from = tokenMatch.index + triggerOffsetWithinMatch;
  const query = tokenMatch[2] ?? "";

  return {
    active: true,
    trigger,
    query,
    from,
    to: cursor,
  };
}

export function inactiveSlashTrigger(cursor = 0): ComposerSlashTriggerState {
  return {
    active: false,
    trigger: "/",
    query: "",
    from: cursor,
    to: cursor,
  };
}

export function filterComposerSlashCommands(input: {
  commands: readonly ComposerSlashCommand[];
  query: string;
  composerText: string;
  trigger?: ComposerSlashCommandTrigger;
}): ComposerSlashCommandMatch[] {
  const trigger = input.trigger ?? "/";
  const trimmedComposerText = input.composerText.trim();
  const isComposerEmpty =
    trimmedComposerText.length === 0 ||
    trimmedComposerText.startsWith("/") ||
    trimmedComposerText.startsWith("@");
  const normalizedQuery = normalizeSlashSearchText(input.query);
  const matches: ComposerSlashCommandMatch[] = [];

  for (const command of input.commands) {
    if (command.isVisible === false) continue;
    if (!supportsSlashCommandTrigger(command, trigger)) continue;
    if (command.requiresEmptyComposer === true && !isComposerEmpty) continue;

    const match = matchSlashCommand(command, normalizedQuery);
    if (!match) continue;
    matches.push(match);
  }

  return matches.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    return a.command.title.localeCompare(b.command.title);
  });
}

function supportsSlashCommandTrigger(
  command: ComposerSlashCommand,
  trigger: ComposerSlashCommandTrigger,
): boolean {
  return (command.triggers ?? ["/"]).includes(trigger);
}

export function groupComposerSlashCommandMatches(
  matches: readonly ComposerSlashCommandMatch[],
): ComposerSlashCommandGroup[] {
  const groups: ComposerSlashCommandGroup[] = [];
  const groupById = new Map<string, ComposerSlashCommandGroup>();

  for (const match of matches) {
    const groupId = match.command.group;
    const existingGroup = groupById.get(groupId);
    if (existingGroup) {
      existingGroup.commands.push(match.command);
      continue;
    }

    const nextGroup = {
      id: groupId,
      label: groupId,
      commands: [match.command],
    };
    groupById.set(groupId, nextGroup);
    groups.push(nextGroup);
  }

  return groups;
}

export function resolveNextSlashHighlight(input: {
  matches: readonly ComposerSlashCommandMatch[];
  currentCommandId: string | null;
  direction: "first" | "next" | "previous";
}): string | null {
  if (input.matches.length === 0) return null;
  if (input.direction === "first" || !input.currentCommandId) {
    return input.matches[0]?.command.id ?? null;
  }

  const currentIndex = input.matches.findIndex((match) => match.command.id === input.currentCommandId);
  if (currentIndex < 0) return input.matches[0]?.command.id ?? null;

  if (input.direction === "next") {
    return input.matches[(currentIndex + 1) % input.matches.length]?.command.id ?? null;
  }

  return input.matches[(currentIndex - 1 + input.matches.length) % input.matches.length]?.command.id ?? null;
}

export function resolvePreservedSlashHighlight(input: {
  matches: readonly ComposerSlashCommandMatch[];
  currentCommandId: string | null;
}): string | null {
  if (input.matches.length === 0) return null;
  if (!input.currentCommandId) return input.matches[0]?.command.id ?? null;

  const currentStillVisible = input.matches.some((match) => match.command.id === input.currentCommandId);
  if (currentStillVisible) return input.currentCommandId;

  return input.matches[0]?.command.id ?? null;
}

function matchSlashCommand(command: ComposerSlashCommand, normalizedQuery: string): ComposerSlashCommandMatch | null {
  if (!normalizedQuery) {
    return {
      command,
      score: 1,
      matchedTitleIndexes: [],
    };
  }

  const title = command.title;
  const normalizedTitle = normalizeSlashSearchText(title);
  const substringIndex = normalizedTitle.indexOf(normalizedQuery);
  if (substringIndex >= 0) {
    return {
      command,
      score: 1000 - substringIndex,
      matchedTitleIndexes: Array.from({ length: normalizedQuery.length }, (_, index) => substringIndex + index),
    };
  }

  const fuzzyIndexes = fuzzyMatchIndexes(normalizedTitle, normalizedQuery);
  if (!fuzzyIndexes) return null;

  const spreadPenalty = fuzzyIndexes.at(-1)! - fuzzyIndexes[0]!;
  return {
    command,
    score: 500 - spreadPenalty,
    matchedTitleIndexes: fuzzyIndexes,
  };
}

function fuzzyMatchIndexes(text: string, query: string): number[] | null {
  const indexes: number[] = [];
  let textIndex = 0;

  for (const queryChar of query) {
    const nextIndex = text.indexOf(queryChar, textIndex);
    if (nextIndex < 0) return null;
    indexes.push(nextIndex);
    textIndex = nextIndex + 1;
  }

  return indexes;
}

function normalizeSlashSearchText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/gu, " ");
}
