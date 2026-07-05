import type { ThreadCollapsedToolActivitySummaryStats } from "../thread-stage-types";

export interface CollapsedToolActivitySummaryOptions {
  showFileChangeLineCount?: boolean;
}

function pluralize(count: number, one: string, other: string): string {
  return `${count} ${count === 1 ? one : other}`;
}

function formatFileCount(count: number): string {
  return count === 1 ? "a file" : `${count} files`;
}

function formatWrittenLineCount(count: number): string {
  return count === 1 ? "a line" : `${count} lines`;
}

function addFileCountPart(parts: string[], count: number, leading: string, trailing: string, suffix = ""): void {
  if (count <= 0) return;
  const verb = parts.length === 0 ? leading : trailing;
  parts.push(`${verb} ${formatFileCount(count)}${suffix}`);
}

function formatExplorationSummaryPart(stats: ThreadCollapsedToolActivitySummaryStats, isLeading: boolean): string | null {
  const exploredFileCount = stats.exploredFileCount + stats.runningExploredFileCount;
  const searchCount = stats.searchCount + stats.runningSearchCount;
  const listCount = stats.listCount + stats.runningListCount;
  const isRunning = stats.runningExploredFileCount > 0 || stats.runningSearchCount > 0 || stats.runningListCount > 0;

  if (exploredFileCount === 0 && searchCount === 0 && listCount === 0) return null;
  if (exploredFileCount === 0 && searchCount === 0) {
    if (isRunning) return isLeading ? "Listing files" : "listing files";
    return isLeading ? "Listed files" : "listed files";
  }

  const details: string[] = [];
  if (exploredFileCount > 0) details.push(pluralize(exploredFileCount, "file", "files"));
  if (searchCount > 0) details.push(pluralize(searchCount, "search", "searches"));
  if (listCount > 0) details.push(pluralize(listCount, "list", "lists"));

  const verb = isRunning
    ? isLeading ? "Exploring" : "exploring"
    : isLeading ? "Explored" : "explored";
  return `${verb} ${details.join(", ")}`;
}

function addCountPart(parts: string[], completedCount: number, runningCount: number, labels: {
  completedLeading: string;
  completed: string;
  runningLeading: string;
  running: string;
  singular: string;
  plural: string;
}): void {
  if (completedCount > 0) {
    parts.push(`${parts.length === 0 ? labels.completedLeading : labels.completed} ${pluralize(completedCount, labels.singular, labels.plural)}`);
  }
  if (runningCount > 0) {
    parts.push(`${parts.length === 0 ? labels.runningLeading : labels.running} ${pluralize(runningCount, labels.singular, labels.plural)}`);
  }
}

function addTimedOutRequestPart(parts: string[], timedOutRequestCount: number): void {
  if (timedOutRequestCount <= 0) return;
  if (parts.length === 0) {
    parts.push(timedOutRequestCount === 1 ? "Request timed out" : `${timedOutRequestCount} requests timed out`);
    return;
  }
  parts.push(timedOutRequestCount === 1 ? "request timed out" : `${timedOutRequestCount} requests timed out`);
}

export function buildCollapsedToolActivitySummary(
  stats: ThreadCollapsedToolActivitySummaryStats,
  options: CollapsedToolActivitySummaryOptions = {},
): { summary: string; parts: string[] } | null {
  const parts: string[] = [];
  const completedCreated = stats.createdFileCount - stats.runningCreatedFileCount - stats.stoppedCreatedFileCount;
  const completedEdited = stats.editedFileCount - stats.runningEditedFileCount;
  const completedDeleted = stats.deletedFileCount - stats.runningDeletedFileCount;
  const hasFileChangeSummary =
    stats.createdFileCount > 0
    || stats.runningCreatedFileCount > 0
    || stats.stoppedCreatedFileCount > 0
    || stats.editedFileCount > 0
    || stats.runningEditedFileCount > 0
    || stats.deletedFileCount > 0
    || stats.runningDeletedFileCount > 0;
  const showChangedLineCount = options.showFileChangeLineCount === true && hasFileChangeSummary;
  const runningCreatedLineSuffix = !showChangedLineCount && stats.runningCreatedLineCount > 0
    ? ` • writing ${formatWrittenLineCount(stats.runningCreatedLineCount)}`
    : "";

  addFileCountPart(parts, Math.max(completedCreated, 0), "Created", "created");
  addFileCountPart(parts, stats.stoppedCreatedFileCount, "Stopped creating", "stopped creating");
  addFileCountPart(parts, stats.runningCreatedFileCount, "Creating", "creating", runningCreatedLineSuffix);
  addFileCountPart(parts, Math.max(completedEdited, 0), "Edited", "edited");
  addFileCountPart(parts, stats.runningEditedFileCount, "Editing", "editing");
  addFileCountPart(parts, Math.max(completedDeleted, 0), "Deleted", "deleted");
  addFileCountPart(parts, stats.runningDeletedFileCount, "Deleting", "deleting");

  const explorationPart = formatExplorationSummaryPart(stats, parts.length === 0);
  if (explorationPart) parts.push(explorationPart);

  addCountPart(parts, stats.deniedRequestCount, 0, {
    completedLeading: "Denied",
    completed: "denied",
    runningLeading: "Denied",
    running: "denied",
    singular: "request",
    plural: "requests",
  });
  addTimedOutRequestPart(parts, stats.timedOutRequestCount);
  addCountPart(parts, stats.hookCount - stats.runningHookCount, stats.runningHookCount, {
    completedLeading: "Ran",
    completed: "ran",
    runningLeading: "Running",
    running: "running",
    singular: "hook",
    plural: "hooks",
  });
  addCountPart(parts, stats.commandCount - stats.runningCommandCount, stats.runningCommandCount, {
    completedLeading: "Ran",
    completed: "ran",
    runningLeading: "Running",
    running: "running",
    singular: "command",
    plural: "commands",
  });

  if (stats.mcpToolCallCount > 0) {
    const namedSourceCallCount = stats.mcpToolCallSources.reduce((sum, source) => sum + source.count, 0);
    const unnamedCount = stats.mcpToolCallCount - namedSourceCallCount;
    if (stats.mcpToolCallSources.length > 0) {
      const sourceNames = stats.mcpToolCallSources.map((source) => (
        source.name === "browser-use" ? "the browser" : source.name
      ));
      const sourceText = sourceNames.length === 1
        ? sourceNames[0]
        : `${sourceNames.slice(0, -1).join(", ")} and ${sourceNames[sourceNames.length - 1]}`;
      parts.push(`${parts.length === 0 ? "Used" : "used"} ${sourceText}`);
    }
    addCountPart(parts, Math.max(unnamedCount, 0), 0, {
      completedLeading: "Called",
      completed: "called",
      runningLeading: "Called",
      running: "called",
      singular: "tool",
      plural: "tools",
    });
  }

  addCountPart(parts, stats.webSearchCount, stats.runningWebSearchCount, {
    completedLeading: "Searched web",
    completed: "searched web",
    runningLeading: "Searching the web",
    running: "searching the web",
    singular: "time",
    plural: "times",
  });

  if (parts.length === 0) return null;
  const lineSuffix = showChangedLineCount
    ? ` • ${pluralize(stats.changedLineCount, "line", "lines")}`
    : "";
  return { summary: `${parts.join(", ")}${lineSuffix}`, parts };
}
