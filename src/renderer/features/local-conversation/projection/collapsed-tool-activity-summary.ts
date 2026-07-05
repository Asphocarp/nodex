import type { ThreadCollapsedToolActivitySummaryStats } from "../thread-stage-types";

export interface CollapsedToolActivitySummaryOptions {
  showFileChangeLineCount?: boolean;
  showRunningCommandSummary?: boolean;
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

function formatConjunction(items: readonly string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function pushUnique(items: string[], value: string): void {
  if (items.includes(value)) return;
  items.push(value);
}

function addFileCountPart(parts: string[], count: number, leading: string, trailing: string, suffix = ""): void {
  if (count <= 0) return;
  const verb = parts.length === 0 ? leading : trailing;
  parts.push(`${verb} ${formatFileCount(count)}${suffix}`);
}

function formatExplorationSummaryPart(stats: ThreadCollapsedToolActivitySummaryStats, isLeading: boolean): string | null {
  const parts: string[] = [];
  if (stats.exploredFileCount > 0) {
    const verb = stats.runningExploredFileCount > 0
      ? isLeading ? "Reading" : "reading"
      : isLeading ? "Read" : "read";
    parts.push(`${verb} ${formatFileCount(stats.exploredFileCount)}`);
  }
  if (stats.searchCount > 0) {
    const text = stats.runningSearchCount > 0
      ? isLeading && parts.length === 0 ? "Searching code" : "searching code"
      : isLeading && parts.length === 0 ? "Searched code" : "searched code";
    parts.push(text);
  }
  if (stats.listCount > 0) {
    const text = stats.runningListCount > 0
      ? isLeading && parts.length === 0 ? "Listing files" : "listing files"
      : isLeading && parts.length === 0 ? "Listed files" : "listed files";
    parts.push(text);
  }
  if (parts.length === 0) return null;
  return formatConjunction(parts);
}

function addLoadedToolParts(parts: string[], completedCount: number, runningCount: number): void {
  if (completedCount > 0) {
    const verb = parts.length === 0 ? "Loaded" : "loaded";
    parts.push(`${verb} ${completedCount === 1 ? "a tool" : `${completedCount} tools`}`);
  }
  if (runningCount > 0) {
    const verb = parts.length === 0 ? "Loading" : "loading";
    parts.push(`${verb} ${runningCount === 1 ? "a tool" : `${runningCount} tools`}`);
  }
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

function addDeniedRequestPart(parts: string[], deniedRequestCount: number): void {
  if (deniedRequestCount <= 0) return;
  if (parts.length === 0) {
    parts.push(deniedRequestCount === 1 ? "Denied request" : `Denied ${deniedRequestCount} requests`);
    return;
  }
  parts.push(deniedRequestCount === 1 ? "denied request" : `denied ${deniedRequestCount} requests`);
}

function addGenericCommandPart(parts: string[], count: number, isRunning: boolean): void {
  if (count <= 0) return;
  if (isRunning) {
    parts.push(parts.length === 0
      ? count === 1 ? "Running a command" : `Running ${count} commands`
      : count === 1 ? "running a command" : `running ${count} commands`);
    return;
  }

  parts.push(parts.length === 0
    ? count === 1 ? "Ran a command" : `Ran ${count} commands`
    : count === 1 ? "ran a command" : `ran ${count} commands`);
}

function addCommandSummaryParts(
  parts: string[],
  stats: ThreadCollapsedToolActivitySummaryStats,
  showRunningCommandSummary: boolean,
): void {
  const runningCommandCount = showRunningCommandSummary ? stats.runningCommandCount : 0;
  const completedWebSearchCommandCount = showRunningCommandSummary ? stats.completedWebSearchCommandCount : 0;
  const completedCommandCount = Math.max(
    stats.commandCount - runningCommandCount - completedWebSearchCommandCount,
    0,
  );

  if (completedWebSearchCommandCount > 0) {
    parts.push(parts.length === 0 ? "Searched the web" : "searched the web");
  }

  addGenericCommandPart(parts, completedCommandCount, false);

  if (runningCommandCount <= 0) return;

  const onlyRunningFolderCreation = runningCommandCount === stats.runningFolderCreationCommandCount;
  if (onlyRunningFolderCreation) {
    parts.push(parts.length === 0
      ? runningCommandCount === 1 ? "Creating folder" : `Creating ${runningCommandCount} folders`
      : runningCommandCount === 1 ? "creating folder" : `creating ${runningCommandCount} folders`);
    return;
  }

  const onlyRunningWebSearch = runningCommandCount === stats.runningWebSearchCommandCount;
  if (onlyRunningWebSearch) {
    parts.push(parts.length === 0 ? "Searching the web" : "searching the web");
    return;
  }

  addGenericCommandPart(parts, runningCommandCount, true);
}

function addWebSearchSummaryPart(parts: string[], completedCount: number, runningCount: number): void {
  const totalCount = completedCount + runningCount;
  if (totalCount <= 0) return;

  if (runningCount > 0) {
    parts.push(parts.length === 0 ? "Searching the web" : "searching the web");
    return;
  }

  parts.push(parts.length === 0 ? "Searched the web" : "searched the web");
}

const NODE_REPL_MCP_SOURCE_KEY = "server:node_repl";
const BROWSER_USE_MCP_SOURCE_KEY = "browser-use";
const NON_INTEGRATION_MCP_SOURCE_KEY = "navigate_to_codex_page";

function formatMcpSourceName(source: ThreadCollapsedToolActivitySummaryStats["mcpToolCallSources"][number]): string {
  if (source.key === BROWSER_USE_MCP_SOURCE_KEY) return "the browser";
  return source.name;
}

function addMcpNamedSourcePart(
  parts: string[],
  sources: readonly string[],
  allIntegrationSources: boolean,
  isRunning: boolean,
): void {
  if (sources.length === 0) return;

  const sourceText = formatConjunction(sources);
  if (!allIntegrationSources) {
    const verb = isRunning
      ? parts.length === 0 ? "Using" : "using"
      : parts.length === 0 ? "Used" : "used";
    parts.push(`${verb} ${sourceText}`);
    return;
  }

  const verb = isRunning
    ? parts.length === 0 ? "Using" : "using"
    : parts.length === 0 ? "Used" : "used";
  const integrationLabel = sources.length === 1 ? "integration" : "integrations";
  parts.push(`${verb} ${sourceText} ${integrationLabel}`);
}

function addMcpSummaryParts(
  parts: string[],
  stats: ThreadCollapsedToolActivitySummaryStats,
  completedLoadedToolCount: number,
): void {
  if (stats.mcpToolCallCount <= 0) return;

  const completedSourceNames: string[] = [];
  const runningSourceNames: string[] = [];
  let allCompletedSourcesAreIntegrations = true;
  let allRunningSourcesAreIntegrations = true;
  let nodeReplCount = 0;
  let runningNodeReplCount = 0;

  for (const source of stats.mcpToolCallSources) {
    if (source.key === NODE_REPL_MCP_SOURCE_KEY) {
      nodeReplCount += source.count;
      runningNodeReplCount += source.runningCount;
      continue;
    }

    const sourceName = formatMcpSourceName(source);
    const isIntegrationSource = source.key !== NON_INTEGRATION_MCP_SOURCE_KEY;
    if (source.count > source.runningCount) {
      allCompletedSourcesAreIntegrations = allCompletedSourcesAreIntegrations && isIntegrationSource;
      pushUnique(completedSourceNames, sourceName);
    }
    if (source.runningCount > 0) {
      allRunningSourcesAreIntegrations = allRunningSourcesAreIntegrations && isIntegrationSource;
      pushUnique(runningSourceNames, sourceName);
    }
  }

  const completedNodeReplCount = Math.max(nodeReplCount - runningNodeReplCount, 0);
  addGenericCommandPart(parts, completedNodeReplCount, false);
  addGenericCommandPart(parts, runningNodeReplCount, true);

  const namedSourceCallCount = stats.mcpToolCallSources.reduce((sum, source) => sum + source.count, 0);
  const unnamedCount = Math.max(stats.mcpToolCallCount - namedSourceCallCount, 0);

  if (completedSourceNames.length > 0) {
    const sourceText = formatConjunction(completedSourceNames);
    if (
      parts.length === 1
      && completedLoadedToolCount > 0
      && runningSourceNames.length === 0
      && allCompletedSourcesAreIntegrations
    ) {
      const loadedText = completedLoadedToolCount === 1 ? "Loaded a tool" : `Loaded ${completedLoadedToolCount} tools`;
      parts[0] = `${loadedText} and used ${sourceText}`;
    } else {
      addMcpNamedSourcePart(parts, completedSourceNames, allCompletedSourcesAreIntegrations, false);
    }
  }

  addMcpNamedSourcePart(parts, runningSourceNames, allRunningSourcesAreIntegrations, true);

  if (unnamedCount <= 0) return;
  if (parts.length === 0) {
    parts.push(stats.mcpToolCallCount === 1 ? "Called a tool" : `Called ${stats.mcpToolCallCount} tools`);
    return;
  }
  parts.push(unnamedCount === 1 ? "called a tool" : `called ${unnamedCount} tools`);
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
  const showRunningCommandSummary = options.showRunningCommandSummary ?? true;
  const runningCreatedLineSuffix = !showChangedLineCount && stats.runningCreatedLineCount > 0
    ? ` • writing ${formatWrittenLineCount(stats.runningCreatedLineCount)}`
    : "";
  const completedLoadedToolCount = Math.max(stats.loadedToolCount - stats.runningLoadedToolCount, 0);

  addFileCountPart(parts, Math.max(completedCreated, 0), "Created", "created");
  addFileCountPart(parts, stats.stoppedCreatedFileCount, "Stopped creating", "stopped creating");
  addFileCountPart(parts, stats.runningCreatedFileCount, "Creating", "creating", runningCreatedLineSuffix);
  addFileCountPart(parts, Math.max(completedEdited, 0), "Edited", "edited");
  addFileCountPart(parts, stats.runningEditedFileCount, "Editing", "editing");
  addFileCountPart(parts, Math.max(completedDeleted, 0), "Deleted", "deleted");
  addFileCountPart(parts, stats.runningDeletedFileCount, "Deleting", "deleting");

  addLoadedToolParts(
    parts,
    completedLoadedToolCount,
    stats.runningLoadedToolCount,
  );

  const explorationPart = formatExplorationSummaryPart(stats, parts.length === 0);
  if (explorationPart) parts.push(explorationPart);

  addDeniedRequestPart(parts, stats.deniedRequestCount);
  addTimedOutRequestPart(parts, stats.timedOutRequestCount);
  addCountPart(parts, stats.hookCount - stats.runningHookCount, stats.runningHookCount, {
    completedLeading: "Ran",
    completed: "ran",
    runningLeading: "Running",
    running: "running",
    singular: "hook",
    plural: "hooks",
  });
  addCommandSummaryParts(parts, stats, showRunningCommandSummary);
  addMcpSummaryParts(parts, stats, completedLoadedToolCount);

  addWebSearchSummaryPart(parts, stats.webSearchCount, stats.runningWebSearchCount);

  if (parts.length === 0) return null;
  const lineSuffix = showChangedLineCount
    ? ` • ${pluralize(stats.changedLineCount, "line", "lines")}`
    : "";
  return { summary: `${parts.join(", ")}${lineSuffix}`, parts };
}
