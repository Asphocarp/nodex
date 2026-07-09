import type { ThreadItem } from "@nodex/codex-app-server-protocol/v2/ThreadItem";

type UnknownRecord = Readonly<Record<string, unknown>>;

function asRecord(value: unknown): UnknownRecord | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as UnknownRecord;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isNullableFiniteNumber(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isImageDetail(value: unknown): boolean {
  return value === undefined
    || value === "auto"
    || value === "low"
    || value === "high"
    || value === "original";
}

function isJsonValue(value: unknown): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  const record = asRecord(value);
  return record !== null && Object.values(record).every(isJsonValue);
}

function isUserInput(value: unknown): boolean {
  const input = asRecord(value);
  if (!input) return false;
  switch (input.type) {
    case "text":
      return typeof input.text === "string"
        && Array.isArray(input.text_elements)
        && input.text_elements.every((elementValue) => {
          const element = asRecord(elementValue);
          const byteRange = asRecord(element?.byteRange);
          return Boolean(
            element
            && byteRange
            && typeof byteRange.start === "number"
            && Number.isFinite(byteRange.start)
            && typeof byteRange.end === "number"
            && Number.isFinite(byteRange.end)
            && isNullableString(element.placeholder),
          );
        });
    case "image":
      return typeof input.url === "string" && isImageDetail(input.detail);
    case "localImage":
      return typeof input.path === "string" && isImageDetail(input.detail);
    case "skill":
    case "mention":
      return typeof input.name === "string" && typeof input.path === "string";
    default:
      return false;
  }
}

function isCommandAction(value: unknown): boolean {
  const action = asRecord(value);
  if (!action || typeof action.command !== "string") return false;
  switch (action.type) {
    case "read":
      return typeof action.name === "string" && typeof action.path === "string";
    case "listFiles":
      return isNullableString(action.path);
    case "search":
      return isNullableString(action.query) && isNullableString(action.path);
    case "unknown":
      return true;
    default:
      return false;
  }
}

function isFileUpdateChange(value: unknown): boolean {
  const change = asRecord(value);
  const kind = asRecord(change?.kind);
  if (!change || !kind || typeof change.path !== "string" || typeof change.diff !== "string") {
    return false;
  }
  if (kind.type === "add" || kind.type === "delete") return true;
  return kind.type === "update" && isNullableString(kind.move_path);
}

function isMcpAppContext(value: unknown): boolean {
  if (value === null) return true;
  const context = asRecord(value);
  if (!context || typeof context.connectorId !== "string") return false;
  return isNullableString(context.linkId)
    && isNullableString(context.resourceUri)
    && isNullableString(context.appName)
    && isNullableString(context.templateId)
    && isNullableString(context.actionName);
}

function isMcpResult(value: unknown): boolean {
  if (value === null) return true;
  const result = asRecord(value);
  return Boolean(
    result
    && Array.isArray(result.content)
    && result.content.every(isJsonValue)
    && isJsonValue(result.structuredContent)
    && isJsonValue(result._meta),
  );
}

function isMcpError(value: unknown): boolean {
  if (value === null) return true;
  const error = asRecord(value);
  return Boolean(error && typeof error.message === "string");
}

function isDynamicContentItem(value: unknown): boolean {
  const item = asRecord(value);
  if (!item) return false;
  if (item.type === "inputText") return typeof item.text === "string";
  if (item.type === "inputImage") return typeof item.imageUrl === "string";
  return false;
}

function isCollabAgentStateMap(value: unknown): boolean {
  const states = asRecord(value);
  if (!states) return false;
  return Object.values(states).every((stateValue) => {
    const state = asRecord(stateValue);
    return Boolean(
      state
      && (
        state.status === "pendingInit"
        || state.status === "running"
        || state.status === "interrupted"
        || state.status === "completed"
        || state.status === "errored"
        || state.status === "shutdown"
        || state.status === "notFound"
      )
      && isNullableString(state.message),
    );
  });
}

function isMemoryCitation(value: unknown): boolean {
  if (value === null) return true;
  const citation = asRecord(value);
  return Boolean(
    citation
    && isStringArray(citation.threadIds)
    && Array.isArray(citation.entries)
    && citation.entries.every((entryValue) => {
      const entry = asRecord(entryValue);
      return Boolean(
        entry
        && typeof entry.path === "string"
        && typeof entry.lineStart === "number"
        && Number.isFinite(entry.lineStart)
        && typeof entry.lineEnd === "number"
        && Number.isFinite(entry.lineEnd)
        && typeof entry.note === "string",
      );
    }),
  );
}

function isWebSearchAction(value: unknown): boolean {
  if (value === null) return true;
  const action = asRecord(value);
  if (!action) return false;
  switch (action.type) {
    case "search":
      return isNullableString(action.query)
        && (action.queries === null || isStringArray(action.queries));
    case "openPage":
      return isNullableString(action.url);
    case "findInPage":
      return isNullableString(action.url)
        && isNullableString(action.pattern);
    case "other":
      return true;
    default:
      return false;
  }
}

function isCommonItem(record: UnknownRecord): boolean {
  return typeof record.id === "string" && typeof record.type === "string";
}

/**
 * Runtime boundary for the generated `ThreadItem` union.
 *
 * The app-server transport is statically generated, but its JSON/IPC inputs are
 * still untrusted at runtime. Validate every field consumed by the exhaustive
 * canonical projector before admitting an item to canonical state.
 */
export function isCodexProtocolThreadItem(value: unknown): value is ThreadItem {
  const item = asRecord(value);
  if (!item || !isCommonItem(item)) return false;

  switch (item.type) {
    case "userMessage":
      return isNullableString(item.clientId)
        && Array.isArray(item.content)
        && item.content.every(isUserInput);
    case "hookPrompt":
      return Array.isArray(item.fragments)
        && item.fragments.every((fragmentValue) => {
          const fragment = asRecord(fragmentValue);
          return Boolean(
            fragment
            && typeof fragment.text === "string"
            && typeof fragment.hookRunId === "string",
          );
        });
    case "agentMessage":
      return typeof item.text === "string"
        && (
          item.phase === null
          || item.phase === "commentary"
          || item.phase === "final_answer"
        )
        && isMemoryCitation(item.memoryCitation);
    case "plan":
      return typeof item.text === "string";
    case "reasoning":
      return isStringArray(item.summary) && isStringArray(item.content);
    case "commandExecution":
      return typeof item.command === "string"
        && typeof item.cwd === "string"
        && isNullableString(item.processId)
        && (
          item.source === "agent"
          || item.source === "userShell"
          || item.source === "unifiedExecStartup"
          || item.source === "unifiedExecInteraction"
        )
        && (
          item.status === "inProgress"
          || item.status === "completed"
          || item.status === "failed"
          || item.status === "declined"
        )
        && Array.isArray(item.commandActions)
        && item.commandActions.every(isCommandAction)
        && isNullableString(item.aggregatedOutput)
        && isNullableFiniteNumber(item.exitCode)
        && isNullableFiniteNumber(item.durationMs);
    case "fileChange":
      return Array.isArray(item.changes)
        && item.changes.every(isFileUpdateChange)
        && (
          item.status === "inProgress"
          || item.status === "completed"
          || item.status === "failed"
          || item.status === "declined"
        );
    case "mcpToolCall":
      return typeof item.server === "string"
        && typeof item.tool === "string"
        && (
          item.status === "inProgress"
          || item.status === "completed"
          || item.status === "failed"
        )
        && isJsonValue(item.arguments)
        && isMcpAppContext(item.appContext)
        && isNullableString(item.pluginId)
        && isMcpResult(item.result)
        && isMcpError(item.error)
        && isNullableFiniteNumber(item.durationMs)
        && (item.mcpAppResourceUri === undefined || typeof item.mcpAppResourceUri === "string");
    case "dynamicToolCall":
      return isNullableString(item.namespace)
        && typeof item.tool === "string"
        && isJsonValue(item.arguments)
        && (
          item.status === "inProgress"
          || item.status === "completed"
          || item.status === "failed"
        )
        && (
          item.contentItems === null
          || (Array.isArray(item.contentItems) && item.contentItems.every(isDynamicContentItem))
        )
        && (item.success === null || typeof item.success === "boolean")
        && isNullableFiniteNumber(item.durationMs);
    case "collabAgentToolCall":
      return (
        item.tool === "spawnAgent"
        || item.tool === "sendInput"
        || item.tool === "resumeAgent"
        || item.tool === "wait"
        || item.tool === "closeAgent"
      )
        && (
          item.status === "inProgress"
          || item.status === "completed"
          || item.status === "failed"
        )
        && typeof item.senderThreadId === "string"
        && isStringArray(item.receiverThreadIds)
        && isNullableString(item.prompt)
        && isNullableString(item.model)
        && isNullableString(item.reasoningEffort)
        && isCollabAgentStateMap(item.agentsStates);
    case "subAgentActivity":
      return (
        item.kind === "started"
        || item.kind === "interacted"
        || item.kind === "interrupted"
      )
        && typeof item.agentThreadId === "string"
        && typeof item.agentPath === "string";
    case "webSearch":
      return typeof item.query === "string" && isWebSearchAction(item.action);
    case "imageView":
      return typeof item.path === "string";
    case "sleep":
      return typeof item.durationMs === "number" && Number.isFinite(item.durationMs);
    case "imageGeneration":
      return typeof item.status === "string"
        && isNullableString(item.revisedPrompt)
        && typeof item.result === "string"
        && (item.savedPath === undefined || typeof item.savedPath === "string");
    case "enteredReviewMode":
    case "exitedReviewMode":
      return typeof item.review === "string";
    case "contextCompaction":
      return true;
    default:
      return false;
  }
}
