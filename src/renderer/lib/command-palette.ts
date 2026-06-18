import { matchesSearchTokens, tokenizeSearchQuery } from "./card-search";
import {
  createCommandPaletteCardSearchIndex,
  normalizeCommandPaletteSearchText,
  type CommandPaletteCardSearchIndex,
} from "./command-palette-card-search";
import { CARD_STATUS_LABELS, CARD_STATUS_ORDER } from "../../shared/card-status";
import {
  TOGGLE_LIST_EMPTY_PRIORITY_LABEL,
  TOGGLE_LIST_PRIORITY_CHIP_LABELS,
  TOGGLE_LIST_PRIORITY_ORDER,
  type ToggleListTagFilterMode,
} from "./toggle-list/types";
import type { CardSummary, Priority } from "./types";

export interface CommandPaletteCommand {
  kind: "command";
  id: string;
  title: string;
  subtitle: string;
  keywords: string[];
  shortcut?: string;
  active?: boolean;
  disabled?: boolean;
  priority: number;
}

export interface CommandPaletteCard {
  kind: "card";
  id: string;
  projectId: string;
  projectName: string;
  projectIcon: string;
  columnName: string;
  card: CardSummary;
  inActiveProject: boolean;
  recentIndex: number | null;
  boardIndex: number;
  searchPreview?: CommandPaletteCardSearchPreview | null;
  searchDecorations?: CommandPaletteCardSearchDecorations | null;
}

export interface CommandPaletteCardSearchPreviewSegment {
  text: string;
  highlight: boolean;
}

export interface CommandPaletteCardSearchBadge {
  id: string;
  label: string;
  segments: CommandPaletteCardSearchPreviewSegment[];
  tone?: "default" | "monospace";
}

export interface CommandPaletteCardSearchPreview {
  excerpt: string;
  segments: CommandPaletteCardSearchPreviewSegment[];
}

export interface CommandPaletteCardSearchDecorations {
  titleSegments?: CommandPaletteCardSearchPreviewSegment[] | null;
  projectNameSegments?: CommandPaletteCardSearchPreviewSegment[] | null;
  columnNameSegments?: CommandPaletteCardSearchPreviewSegment[] | null;
  badges: CommandPaletteCardSearchBadge[];
}

export interface CommandPaletteResults {
  commandMode: boolean;
  query: string;
  commands: CommandPaletteCommand[];
  cards: CommandPaletteCard[];
}

interface ScoredCommand {
  item: CommandPaletteCommand;
  score: number;
}

interface ScoredCard {
  item: CommandPaletteCard;
  score: number;
}

export interface CommandPaletteCardFilters {
  statuses: CardSummary["status"][];
  priorities: Priority[];
  includeEmptyPriority: boolean;
  tags: string[];
  tagMode: ToggleListTagFilterMode;
  assignees: string[];
  projectIds: string[];
}

const DEFAULT_COMMAND_LIMIT = 8;
const DEFAULT_CARD_LIMIT = 12;
const COMMAND_PALETTE_CARD_FILTERS_STORAGE_KEY = "nodex-command-palette-card-filters-v1";
const TAG_FILTER_MODES = new Set<ToggleListTagFilterMode>(["any", "all", "none"]);

function dedupeArray<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function readRawFilterStorageValue(): string | null {
  if (typeof localStorage === "undefined") return null;
  try {
    return localStorage.getItem(COMMAND_PALETTE_CARD_FILTERS_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeRawFilterStorageValue(value: string): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(COMMAND_PALETTE_CARD_FILTERS_STORAGE_KEY, value);
  } catch {
    // ignore localStorage failures
  }
}

export function getDefaultCommandPaletteCardFilters(): CommandPaletteCardFilters {
  return {
    statuses: [...CARD_STATUS_ORDER],
    priorities: [...TOGGLE_LIST_PRIORITY_ORDER],
    includeEmptyPriority: true,
    tags: [],
    tagMode: "any",
    assignees: [],
    projectIds: [],
  };
}

export function cloneCommandPaletteCardFilters(
  filters: CommandPaletteCardFilters,
): CommandPaletteCardFilters {
  return {
    statuses: [...filters.statuses],
    priorities: [...filters.priorities],
    includeEmptyPriority: filters.includeEmptyPriority,
    tags: [...filters.tags],
    tagMode: filters.tagMode,
    assignees: [...filters.assignees],
    projectIds: [...filters.projectIds],
  };
}

export function areCommandPaletteCardFiltersEqual(
  left: CommandPaletteCardFilters,
  right: CommandPaletteCardFilters,
): boolean {
  return left.includeEmptyPriority === right.includeEmptyPriority
    && left.tagMode === right.tagMode
    && left.statuses.length === right.statuses.length
    && left.statuses.every((value, index) => value === right.statuses[index])
    && left.priorities.length === right.priorities.length
    && left.priorities.every((value, index) => value === right.priorities[index])
    && left.tags.length === right.tags.length
    && left.tags.every((value, index) => value === right.tags[index])
    && left.assignees.length === right.assignees.length
    && left.assignees.every((value, index) => value === right.assignees[index])
    && left.projectIds.length === right.projectIds.length
    && left.projectIds.every((value, index) => value === right.projectIds[index]);
}

function normalizeSelectableStrings(
  value: unknown,
  fallback: string[],
  allowedValues?: ReadonlySet<string>,
): string[] {
  if (!Array.isArray(value)) {
    return [...fallback];
  }

  const filteredValues = value
    .filter((item): item is string => typeof item === "string")
    .filter((item) => !allowedValues || allowedValues.has(item));
  return dedupeArray(filteredValues);
}

export function normalizeCommandPaletteCardFilters(
  value: unknown,
  options?: {
    allowedTags?: readonly string[];
    allowedAssignees?: readonly string[];
    allowedProjectIds?: readonly string[];
  },
): CommandPaletteCardFilters {
  const fallback = getDefaultCommandPaletteCardFilters();
  if (!value || typeof value !== "object") {
    return fallback;
  }

  const candidate = value as Record<string, unknown>;
  const allowedTags = options?.allowedTags ? new Set(options.allowedTags) : undefined;
  const allowedAssignees = options?.allowedAssignees ? new Set(options.allowedAssignees) : undefined;
  const allowedProjectIds = options?.allowedProjectIds ? new Set(options.allowedProjectIds) : undefined;

  return {
    statuses: normalizeSelectableStrings(candidate.statuses, fallback.statuses)
      .filter((status): status is CardSummary["status"] => CARD_STATUS_ORDER.includes(status as CardSummary["status"])),
    priorities: normalizeSelectableStrings(candidate.priorities, fallback.priorities)
      .filter((priority): priority is Priority => TOGGLE_LIST_PRIORITY_ORDER.includes(priority as Priority)),
    includeEmptyPriority:
      typeof candidate.includeEmptyPriority === "boolean"
        ? candidate.includeEmptyPriority
        : fallback.includeEmptyPriority,
    tags: normalizeSelectableStrings(candidate.tags, fallback.tags, allowedTags),
    tagMode:
      typeof candidate.tagMode === "string" && TAG_FILTER_MODES.has(candidate.tagMode as ToggleListTagFilterMode)
        ? candidate.tagMode as ToggleListTagFilterMode
        : fallback.tagMode,
    assignees: normalizeSelectableStrings(candidate.assignees, fallback.assignees, allowedAssignees),
    projectIds: normalizeSelectableStrings(candidate.projectIds, fallback.projectIds, allowedProjectIds),
  };
}

export function readCommandPaletteCardFilters(
  options?: Parameters<typeof normalizeCommandPaletteCardFilters>[1],
): CommandPaletteCardFilters {
  const raw = readRawFilterStorageValue();
  if (!raw) {
    return normalizeCommandPaletteCardFilters(null, options);
  }

  try {
    return normalizeCommandPaletteCardFilters(JSON.parse(raw) as unknown, options);
  } catch {
    return normalizeCommandPaletteCardFilters(null, options);
  }
}

export function writeCommandPaletteCardFilters(filters: CommandPaletteCardFilters): CommandPaletteCardFilters {
  const normalized = normalizeCommandPaletteCardFilters(filters);
  writeRawFilterStorageValue(JSON.stringify(normalized));
  return normalized;
}

export function hasActiveCommandPaletteCardFilters(
  filters: CommandPaletteCardFilters,
): boolean {
  if (filters.statuses.length !== CARD_STATUS_ORDER.length) {
    return true;
  }

  if (
    filters.priorities.length !== TOGGLE_LIST_PRIORITY_ORDER.length
    || !filters.includeEmptyPriority
  ) {
    return true;
  }

  return filters.tags.length > 0
    || filters.assignees.length > 0
    || filters.projectIds.length > 0;
}

export function summarizeCommandPaletteCardFilters(
  filters: CommandPaletteCardFilters,
  projectNameById: ReadonlyMap<string, string>,
): Array<{ key: string; label: string; value: string }> {
  const summaries: Array<{ key: string; label: string; value: string }> = [];

  if (filters.statuses.length > 0 && filters.statuses.length < CARD_STATUS_ORDER.length) {
    summaries.push({
      key: "status",
      label: "Status",
      value: filters.statuses.map((status) => CARD_STATUS_LABELS[status]).join(", "),
    });
  }

  const selectedPriorityCount = filters.priorities.length + (filters.includeEmptyPriority ? 1 : 0);
  const totalPriorityCount = TOGGLE_LIST_PRIORITY_ORDER.length + 1;
  if (selectedPriorityCount > 0 && selectedPriorityCount < totalPriorityCount) {
    summaries.push({
      key: "priority",
      label: "Priority",
      value: [
        ...filters.priorities.map((priority) => TOGGLE_LIST_PRIORITY_CHIP_LABELS[priority]),
        ...(filters.includeEmptyPriority ? [TOGGLE_LIST_EMPTY_PRIORITY_LABEL] : []),
      ].join(", "),
    });
  }

  if (filters.tags.length > 0) {
    const modeLabel = filters.tagMode === "any" ? "any" : filters.tagMode === "all" ? "all" : "none";
    summaries.push({
      key: "tags",
      label: `Tags (${modeLabel})`,
      value: filters.tags.join(", "),
    });
  }

  if (filters.assignees.length > 0) {
    summaries.push({
      key: "assignees",
      label: "Assignee",
      value: filters.assignees.join(", "),
    });
  }

  if (filters.projectIds.length > 0) {
    summaries.push({
      key: "projects",
      label: "Project",
      value: filters.projectIds
        .map((projectId) => projectNameById.get(projectId) ?? projectId)
        .join(", "),
    });
  }

  return summaries;
}

function matchesTagFilters(cardTags: string[], filters: CommandPaletteCardFilters): boolean {
  if (filters.tags.length === 0) {
    return true;
  }

  if (filters.tagMode === "any") {
    return cardTags.some((tag) => filters.tags.includes(tag));
  }

  if (filters.tagMode === "all") {
    return filters.tags.every((tag) => cardTags.includes(tag));
  }

  return !cardTags.some((tag) => filters.tags.includes(tag));
}

export function matchesCommandPaletteCardFilters(
  item: CommandPaletteCard,
  filters: CommandPaletteCardFilters,
): boolean {
  if (!filters.statuses.includes(item.card.status)) {
    return false;
  }

  if (item.card.priority) {
    if (!filters.priorities.includes(item.card.priority)) {
      return false;
    }
  } else if (!filters.includeEmptyPriority) {
    return false;
  }

  if (!matchesTagFilters(item.card.tags, filters)) {
    return false;
  }

  if (filters.assignees.length > 0 && !filters.assignees.includes(item.card.assignee ?? "")) {
    return false;
  }

  if (filters.projectIds.length > 0 && !filters.projectIds.includes(item.projectId)) {
    return false;
  }

  return true;
}

function scoreNormalizedText(text: string, query: string): number {
  if (!query) return 0;
  if (!text) return Number.NEGATIVE_INFINITY;
  if (text === query) return 400;
  if (text.startsWith(query)) return 280;

  const wordMatch = text.indexOf(` ${query}`);
  if (wordMatch >= 0) {
    return Math.max(210 - wordMatch, 140);
  }

  const containsIndex = text.indexOf(query);
  if (containsIndex >= 0) {
    return Math.max(130 - containsIndex, 40);
  }

  return Number.NEGATIVE_INFINITY;
}

function buildCommandSearchText(item: CommandPaletteCommand): string {
  return normalizeCommandPaletteSearchText([
    item.title,
    item.subtitle,
    item.keywords.join(" "),
  ].join(" "));
}

function rankCommand(
  item: CommandPaletteCommand,
  query: string,
  tokens: string[],
): ScoredCommand | null {
  const searchText = buildCommandSearchText(item);
  if (tokens.length > 0 && !matchesSearchTokens(searchText, tokens)) {
    return null;
  }

  const normalizedTitle = normalizeCommandPaletteSearchText(item.title);
  const normalizedSubtitle = normalizeCommandPaletteSearchText(item.subtitle);
  const titleScore = scoreNormalizedText(normalizedTitle, query);
  const subtitleScore = scoreNormalizedText(normalizedSubtitle, query);
  const searchScore = scoreNormalizedText(searchText, query);

  let score = item.priority;
  if (query) {
    score += Number.isFinite(titleScore) ? titleScore * 5 : 0;
    score += Number.isFinite(subtitleScore) ? subtitleScore * 2 : 0;
    score += Number.isFinite(searchScore) ? searchScore : 0;
  }
  if (item.active) {
    score += 30;
  }

  return { item, score };
}

function compareScoredCommands(left: ScoredCommand, right: ScoredCommand): number {
  if (right.score !== left.score) return right.score - left.score;
  return left.item.title.localeCompare(right.item.title);
}

function compareDefaultCards(left: CommandPaletteCard, right: CommandPaletteCard): number {
  if (left.inActiveProject !== right.inActiveProject) {
    return left.inActiveProject ? -1 : 1;
  }

  if (left.recentIndex !== right.recentIndex) {
    if (left.recentIndex === null) return 1;
    if (right.recentIndex === null) return -1;
    return left.recentIndex - right.recentIndex;
  }

  if (left.boardIndex !== right.boardIndex) {
    return left.boardIndex - right.boardIndex;
  }

  return left.card.title.localeCompare(right.card.title);
}

function compareScoredCards(left: ScoredCard, right: ScoredCard): number {
  if (right.score !== left.score) return right.score - left.score;
  return compareDefaultCards(left.item, right.item);
}

export function filterCommandPaletteItems(input: {
  query: string;
  commands: CommandPaletteCommand[];
  cards: CommandPaletteCard[];
  cardFilters?: CommandPaletteCardFilters | null;
  cardSearchIndex?: CommandPaletteCardSearchIndex | null;
  commandLimit?: number;
  cardLimit?: number;
}): CommandPaletteResults {
  const rawQuery = input.query.trimStart();
  const commandMode = rawQuery.startsWith(">");
  const query = normalizeCommandPaletteSearchText(commandMode ? rawQuery.slice(1) : rawQuery);
  const tokens = tokenizeSearchQuery(query);
  const cardFilters = input.cardFilters ?? getDefaultCommandPaletteCardFilters();

  const commands = commandMode
    ? input.commands
        .map((item) => rankCommand(item, query, tokens))
        .filter((item): item is ScoredCommand => item !== null)
        .sort(compareScoredCommands)
        .slice(0, input.commandLimit ?? DEFAULT_COMMAND_LIMIT)
        .map(({ item }) => item)
    : [];

  if (commandMode) {
    return {
      commandMode,
      query,
      commands,
      cards: [],
    };
  }

  const cards = query
    ? (
        input.cardSearchIndex === undefined
          ? createCommandPaletteCardSearchIndex(input.cards).search(query)
          : input.cardSearchIndex?.search(query) ?? []
      )
        .filter(({ item }) => matchesCommandPaletteCardFilters(item, cardFilters))
        .sort(compareScoredCards)
        .slice(0, input.cardLimit ?? DEFAULT_CARD_LIMIT)
        .map(({ item }) => item)
    : input.cards
        .slice()
        .filter((item) => matchesCommandPaletteCardFilters(item, cardFilters))
        .sort(compareDefaultCards)
        .slice(0, input.cardLimit ?? DEFAULT_CARD_LIMIT);

  return {
    commandMode,
    query,
    commands,
    cards,
  };
}
