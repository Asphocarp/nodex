import { randomUUID } from "node:crypto";
import type { RequestId } from "@nodex/codex-app-server-protocol";
import type { DynamicToolCallParams } from "@nodex/codex-app-server-protocol/v2/DynamicToolCallParams";
import type { DynamicToolCallResponse } from "@nodex/codex-app-server-protocol/v2/DynamicToolCallResponse";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import type {
  CodexReasoningEffort,
  CodexScheduledAutomationCreateInput,
  CodexScheduledAutomationExecutionEnvironment,
  CodexScheduledAutomationReasoningEffort,
  CodexScheduledAutomationStatus,
  CodexScheduledAutomationUpdateInput,
  CodexTranscriptEntry,
} from "../../shared/types";
import {
  CODEX_APP_TOOL_NAMESPACE,
  isCodexAppDynamicTool,
} from "../../shared/codex-dynamic-tool-identity";
import {
  AUTOMATION_UPDATE_TOOL_NAME,
  buildCodexAppDynamicToolFailure,
  buildCodexAppDynamicToolSuccess,
  CODEX_APP_HANDOFF_MAX_WAIT_MS,
  CODEX_APP_LOCAL_HOST_DISPLAY_NAME,
  CODEX_APP_LOCAL_HOST_ID,
  CODEX_APP_READ_THREAD_DEFAULT_MAX_OUTPUT_CHARS,
  CODEX_APP_READ_THREAD_DEFAULT_TURN_LIMIT,
  CODEX_APP_READ_THREAD_MAX_OUTPUT_CHARS,
  CODEX_APP_READ_THREAD_MAX_TURN_LIMIT,
} from "../codex/codex-app-meta-thread-tools";
import type { CodexDynamicCreatePermissionMode } from "../codex/codex-dynamic-create-permissions";
import type { CodexCreateThreadServiceTierSelector } from "../codex/codex-dynamic-create-service-tier";
import { parseCodexDynamicCreateThreadInput } from "../codex/codex-dynamic-thread-create";
import { createCodexProjectlessWorkspace } from "../codex/codex-projectless-workspace";
import { getCodexFileChangeList } from "../../shared/codex-file-change";
import { CoreModules } from "../core-runtime/CoreModules";
import { TerminalSessions } from "../terminal-runtime/TerminalSessions";
import { CodexApplicationEventHub } from "./CodexApplicationEventHub";
import { AutomationApplication } from "../automation-application/AutomationApplication";
import { CodexConversationFork } from "./CodexConversationFork";
import { CodexPendingServerRequestRuntime } from "./CodexPendingServerRequestRuntime";
import { CodexProjectSessionFork } from "./CodexProjectSessionFork";
import { CodexSessionThreadLaunch } from "./CodexSessionThreadLaunch";
import { CodexThreadCatalog } from "./CodexThreadCatalog";
import { CodexThreadDirectory } from "./CodexThreadDirectory";
import { CodexThreadHandoffRuntime } from "./CodexThreadHandoffRuntime";
import { CodexThreadTitlePersistence } from "./CodexThreadTitlePersistence";
import { CodexTurnCommands } from "./CodexTurnCommands";
import { ConversationCommands } from "./ConversationCommands";

const SAME_DIRECTORY_FORK_CONTINUATION =
  "The fork contains completed history only. If the source thread was running, the active turn and unfinished response are not in the child. Send a follow-up message to threadId only if the task requires work to continue there.";

export interface CodexAppProtocolToolExecutionContext {
  readonly permissionMode?: CodexDynamicCreatePermissionMode;
  readonly serviceTierSelector?: CodexCreateThreadServiceTierSelector;
}

export class CodexAppProtocolTools extends Context.Service<
  CodexAppProtocolTools,
  {
    readonly execute: (
      params: DynamicToolCallParams,
      context?: CodexAppProtocolToolExecutionContext,
    ) => Effect.Effect<DynamicToolCallResponse>;
    readonly respond: (
      requestId: RequestId,
      threadId?: string,
      context?: CodexAppProtocolToolExecutionContext,
    ) => Effect.Effect<DynamicToolCallResponse | null>;
  }
>()("nodex/main/codex-application/CodexAppProtocolTools") {}

type AutomationUpdateMode =
  | "list"
  | "view"
  | "create"
  | "suggested_create"
  | "update"
  | "suggested_update"
  | "delete";
type AutomationDestination = "local" | "worktree" | "thread";
interface ParsedAutomationUpsertArgs {
  readonly mode: "create" | "suggested_create" | "update" | "suggested_update";
  readonly id?: string;
  readonly kind: "cron" | "heartbeat";
  readonly name: string;
  readonly prompt: string;
  readonly rrule: string;
  readonly status: CodexScheduledAutomationStatus;
  readonly cwds?: readonly string[];
  readonly destination?: AutomationDestination;
  readonly executionEnvironment?: CodexScheduledAutomationExecutionEnvironment;
  readonly localEnvironmentConfigPath?: string | null;
  readonly model?: string | null;
  readonly reasoningEffort?: CodexScheduledAutomationReasoningEffort | null;
  readonly targetThreadId?: string;
}
type ParsedAutomationArgs =
  | { readonly mode: "list"; readonly query: string | null; readonly limit: number }
  | { readonly mode: "view" | "delete"; readonly id: string }
  | ParsedAutomationUpsertArgs;

export class CodexAppProtocolToolError extends Data.TaggedError("CodexAppProtocolToolError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

const toolError = (message: string, cause?: unknown): CodexAppProtocolToolError =>
  new CodexAppProtocolToolError({ message, ...(cause === undefined ? {} : { cause }) });

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const stringArg = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized ? normalized : null;
};

const intArg = (value: unknown, fallback: number, min: number, max: number): number =>
  typeof value === "number" && Number.isInteger(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;

const reasoningEffort = (value: unknown): CodexReasoningEffort | undefined =>
  value === "none" ||
  value === "minimal" ||
  value === "low" ||
  value === "medium" ||
  value === "high" ||
  value === "xhigh" ||
  value === "max" ||
  value === "ultra"
    ? value
    : undefined;

const truncate = (value: string, maxChars: number): string => {
  if (maxChars <= 0) return "";
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 3))}...`;
};

const textSuccess = (text: string): DynamicToolCallResponse => ({
  success: true,
  contentItems: [{ type: "inputText", text }],
});

const failureMessage = (cause: unknown): string => {
  if (cause instanceof Error && cause.message.trim()) return cause.message;
  if (typeof cause === "object" && cause !== null && "cause" in cause && cause.cause !== cause) {
    return failureMessage(cause.cause);
  }
  return String(cause);
};

const automationMode = (value: unknown): AutomationUpdateMode | null =>
  value === "list" ||
  value === "view" ||
  value === "create" ||
  value === "suggested_create" ||
  value === "update" ||
  value === "suggested_update" ||
  value === "delete"
    ? value
    : null;

const automationCwds = (value: unknown): readonly string[] | null => {
  const normalize = (items: readonly unknown[]) =>
    items
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter((item, index, items) => item.length > 0 && items.indexOf(item) === index);
  if (Array.isArray(value)) return normalize(value);
  if (typeof value !== "string") return null;
  const input = value.trim();
  if (!input) return [];
  if (input.startsWith("[") && input.endsWith("]")) {
    try {
      const parsed = JSON.parse(input) as unknown;
      return Array.isArray(parsed) ? normalize(parsed) : null;
    } catch {
      return null;
    }
  }
  return normalize(input.split(","));
};

const parseAutomationArgs = (args: Record<string, unknown>): ParsedAutomationArgs => {
  const mode = automationMode(args.mode);
  if (!mode) throw new Error("mode is invalid");
  if (mode === "list") {
    return { mode, query: stringArg(args.query), limit: intArg(args.limit, 20, 1, 100) };
  }
  if (mode === "view" || mode === "delete") {
    const id = stringArg(args.id);
    if (!id) throw new Error("id is required");
    return { mode, id };
  }
  if (args.kind !== "cron" && args.kind !== "heartbeat") throw new Error("kind is invalid");
  const name = stringArg(args.name);
  const prompt = stringArg(args.prompt);
  const rrule = stringArg(args.rrule);
  if (!name || !prompt || !rrule) throw new Error("name, prompt, and rrule are required");
  if (args.status !== "ACTIVE" && args.status !== "PAUSED") throw new Error("status is invalid");
  const destination = args.destination;
  if (
    destination !== undefined &&
    destination !== "local" &&
    destination !== "worktree" &&
    destination !== "thread"
  ) {
    throw new Error("destination is invalid");
  }
  const id = mode === "update" || mode === "suggested_update" ? stringArg(args.id) : null;
  if ((mode === "update" || mode === "suggested_update") && !id) {
    throw new Error("id is required");
  }
  if (args.kind === "heartbeat") {
    const targetThreadId = stringArg(args.targetThreadId) ?? undefined;
    if (!targetThreadId && destination !== "thread") {
      throw new Error("Missing targetThreadId or destination=thread");
    }
    return {
      mode,
      ...(id ? { id } : {}),
      kind: "heartbeat",
      name,
      prompt,
      rrule,
      status: args.status,
      ...(destination ? { destination } : {}),
      ...(targetThreadId ? { targetThreadId } : {}),
    };
  }
  const cwds = automationCwds(args.cwds);
  if (cwds === null) throw new Error("cwds is invalid");
  if (args.executionEnvironment !== "local" && args.executionEnvironment !== "worktree") {
    throw new Error("executionEnvironment is invalid");
  }
  const model = stringArg(args.model);
  const effort = reasoningEffort(args.reasoningEffort);
  if (!model || !effort) throw new Error("model or reasoningEffort is invalid");
  const hasEnvironmentPath = Object.prototype.hasOwnProperty.call(
    args,
    "localEnvironmentConfigPath",
  );
  const environmentPath = hasEnvironmentPath
    ? args.localEnvironmentConfigPath === null
      ? null
      : stringArg(args.localEnvironmentConfigPath)
    : undefined;
  if (hasEnvironmentPath && environmentPath === null && args.localEnvironmentConfigPath !== null) {
    throw new Error("localEnvironmentConfigPath is invalid");
  }
  return {
    mode,
    ...(id ? { id } : {}),
    kind: "cron",
    name,
    prompt,
    rrule,
    status: args.status,
    cwds,
    ...(destination ? { destination } : {}),
    executionEnvironment: args.executionEnvironment,
    ...(hasEnvironmentPath ? { localEnvironmentConfigPath: environmentPath } : {}),
    model,
    reasoningEffort: effort,
  };
};

const automationCreateInput = (
  args: ParsedAutomationUpsertArgs,
  currentThreadId: string,
): CodexScheduledAutomationCreateInput =>
  args.kind === "heartbeat"
    ? {
        kind: "heartbeat",
        name: args.name,
        prompt: args.prompt,
        rrule: args.rrule,
        targetThreadId: args.targetThreadId ?? currentThreadId,
        model: null,
        reasoningEffort: null,
      }
    : {
        kind: "cron",
        name: args.name,
        prompt: args.prompt,
        rrule: args.rrule,
        cwds: [...(args.cwds ?? [])],
        executionEnvironment: args.executionEnvironment ?? "worktree",
        localEnvironmentConfigPath: args.localEnvironmentConfigPath ?? null,
        model: args.model ?? null,
        reasoningEffort: args.reasoningEffort ?? null,
      };

const automationUpdateInput = (
  args: ParsedAutomationUpsertArgs & { readonly id: string },
  currentThreadId: string,
): CodexScheduledAutomationUpdateInput =>
  args.kind === "heartbeat"
    ? {
        id: args.id,
        kind: "heartbeat",
        status: args.status,
        name: args.name,
        prompt: args.prompt,
        rrule: args.rrule,
        targetThreadId: args.targetThreadId ?? currentThreadId,
        model: null,
        reasoningEffort: null,
      }
    : {
        id: args.id,
        kind: "cron",
        status: args.status,
        name: args.name,
        prompt: args.prompt,
        rrule: args.rrule,
        cwds: [...(args.cwds ?? [])],
        executionEnvironment: args.executionEnvironment ?? "worktree",
        ...(args.localEnvironmentConfigPath === undefined
          ? {}
          : { localEnvironmentConfigPath: args.localEnvironmentConfigPath }),
        model: args.model ?? null,
        reasoningEffort: args.reasoningEffort ?? null,
      };

const serializeThreadItem = (
  item: CodexTranscriptEntry,
  includeOutputs: boolean,
  maxOutputCharsPerItem: number,
): Record<string, unknown> => {
  if (item.semanticKind === "userMessage" || item.kind === "userMessage") {
    return { type: "userMessage", id: item.itemId, text: item.markdownText ?? "" };
  }
  if (item.semanticKind === "assistantMessage" || item.kind === "assistantMessage") {
    return {
      type: "agentMessage",
      id: item.itemId,
      text: item.markdownText ?? "",
      phase: item.assistantPhase ?? null,
    };
  }
  if (item.semanticKind === "reasoning") {
    return {
      type: "reasoning",
      id: item.itemId,
      summary: item.markdownText ?? "",
      ...(includeOutputs
        ? { content: truncate(item.markdownText ?? "", maxOutputCharsPerItem) }
        : {}),
    };
  }
  if (item.kind === "commandExecution") {
    return {
      type: "commandExecution",
      id: item.itemId,
      command: item.command ?? null,
      cwd: item.cwd ?? null,
      status: item.status ?? null,
      exitCode: item.exitCode ?? null,
      durationMs: item.durationMs ?? null,
      ...(includeOutputs && item.aggregatedOutput != null
        ? { output: truncate(item.aggregatedOutput, maxOutputCharsPerItem) }
        : {}),
    };
  }
  if (item.kind === "fileChange") {
    return {
      type: "fileChange",
      id: item.itemId,
      status: item.status ?? null,
      changes: getCodexFileChangeList(item.fileChange?.changes).map((change) => {
        const diff =
          change.type === "update"
            ? change.unifiedDiff
            : change.type === "nonRenderable"
              ? ""
              : change.content;
        return {
          path: change.path,
          kind: change.type === "nonRenderable" ? change.originalType : change.type,
          ...(includeOutputs ? { diff: truncate(diff, maxOutputCharsPerItem) } : {}),
        };
      }),
    };
  }
  return {
    type: item.semanticKind ?? item.kind,
    id: item.itemId,
    status: item.status ?? null,
    text: item.markdownText ?? null,
  };
};

export const make: Effect.Effect<
  CodexAppProtocolTools["Service"],
  never,
  | AutomationApplication
  | CodexApplicationEventHub
  | CodexConversationFork
  | CodexPendingServerRequestRuntime
  | CodexProjectSessionFork
  | CodexSessionThreadLaunch
  | CodexThreadCatalog
  | CodexThreadDirectory
  | CodexThreadHandoffRuntime
  | CodexThreadTitlePersistence
  | CodexTurnCommands
  | ConversationCommands
  | CoreModules
  | TerminalSessions
> = Effect.gen(function* () {
  const events = yield* CodexApplicationEventHub;
  const automations = yield* AutomationApplication;
  const conversationFork = yield* CodexConversationFork;
  const pending = yield* CodexPendingServerRequestRuntime;
  const projectSessionFork = yield* CodexProjectSessionFork;
  const sessionLaunch = yield* CodexSessionThreadLaunch;
  const catalog = yield* CodexThreadCatalog;
  const directory = yield* CodexThreadDirectory;
  const handoffs = yield* CodexThreadHandoffRuntime;
  const titles = yield* CodexThreadTitlePersistence;
  const turns = yield* CodexTurnCommands;
  const commands = yield* ConversationCommands;
  const core = yield* CoreModules;
  const terminals = yield* TerminalSessions;

  const requireThread = Effect.fn("CodexAppProtocolTools.requireThread")(function* (
    threadId: string,
  ) {
    const normalized = threadId.trim();
    if (!normalized) return yield* toolError("Thread id is required");
    const entry = yield* directory.resolve({ threadId: normalized, fidelity: "full" });
    if (!entry) return yield* toolError(`Thread '${normalized}' was not found`);
    return entry;
  });

  const handleAutomation = Effect.fn("CodexAppProtocolTools.handleAutomation")(function* (
    params: DynamicToolCallParams,
    args: Record<string, unknown>,
  ) {
    const parsed = yield* Effect.try({
      try: () => parseAutomationArgs(args),
      catch: (cause) =>
        toolError(`${AUTOMATION_UPDATE_TOOL_NAME} received invalid arguments`, cause),
    });
    if (
      (parsed.mode === "create" || parsed.mode === "update") &&
      parsed.kind === "cron" &&
      parsed.executionEnvironment === "worktree" &&
      (parsed.mode === "create"
        ? parsed.localEnvironmentConfigPath != null
        : parsed.localEnvironmentConfigPath !== null)
    ) {
      return buildCodexAppDynamicToolFailure(
        "For safety, automations created by the model cannot immediately run a worktree local environment setup script. Use suggested_create or suggested_update so the user can review and approve it, or set localEnvironmentConfigPath to null.",
      );
    }
    if (parsed.mode === "list") {
      const query = parsed.query?.toLowerCase() ?? "";
      const definitions = (yield* automations.definitions.list())
        .filter((automation) =>
          query
            ? [automation.id, automation.name, automation.prompt]
                .join(" ")
                .toLowerCase()
                .includes(query)
            : true,
        )
        .slice(0, parsed.limit)
        .map((automation) => ({
          id: automation.id,
          kind: automation.kind,
          status: automation.status,
          name: automation.name,
          prompt: automation.prompt,
          rrule: automation.rrule,
          targetThreadId: automation.targetThreadId,
          nextRunAt: automation.nextRunAt,
        }));
      return buildCodexAppDynamicToolSuccess({ query: parsed.query, automations: definitions });
    }
    if (
      parsed.mode === "view" ||
      parsed.mode === "suggested_create" ||
      parsed.mode === "suggested_update"
    ) {
      return textSuccess("Rendered automation card in the app.");
    }
    if (parsed.mode === "delete") {
      const result = yield* automations.definitions.delete(parsed.id);
      if (!result.success) return buildCodexAppDynamicToolFailure("Automation was not deleted.");
      events.publish({
        kind: "codex",
        value: {
          type: "scheduledAutomationChanged",
          event: {
            automationId: result.item?.id ?? parsed.id,
            targetThreadId: result.item?.targetThreadId ?? null,
            reason: "delete",
          },
        },
      });
      return textSuccess(
        `Deleted automation in the app.\n${JSON.stringify({ automationId: parsed.id, mode: "delete" })}`,
      );
    }
    if ("kind" in parsed && parsed.kind === "heartbeat") {
      yield* requireThread(parsed.targetThreadId ?? params.threadId);
    }
    if (parsed.mode === "create") {
      const automation = yield* automations.definitions.create(
        automationCreateInput(parsed, params.threadId),
      );
      events.publish({
        kind: "codex",
        value: {
          type: "scheduledAutomationChanged",
          event: {
            automationId: automation.id,
            targetThreadId: automation.targetThreadId,
            reason: "upsert",
          },
        },
      });
      return textSuccess(
        `Created automation in the app.\n${JSON.stringify({ automationId: automation.id, mode: "create" })}`,
      );
    }
    if (parsed.mode === "update") {
      const id = parsed.id;
      if (!id) return yield* toolError("id is required");
      const current = yield* automations.definitions.get(id);
      if (!current)
        return yield* toolError("Automation does not exist in the app and could not be updated.");
      const automation = yield* automations.definitions.update(
        automationUpdateInput({ ...parsed, id }, params.threadId),
      );
      if (!automation)
        return yield* toolError("Automation does not exist in the app and could not be updated.");
      events.publish({
        kind: "codex",
        value: {
          type: "scheduledAutomationChanged",
          event: {
            automationId: automation.id,
            targetThreadId: automation.targetThreadId,
            reason: "upsert",
          },
        },
      });
      return textSuccess(
        `Updated automation in the app.\n${JSON.stringify({ automationId: automation.id, mode: "update" })}`,
      );
    }
    return yield* toolError(`Unsupported automation mode: ${parsed.mode}`);
  });

  const readThread = Effect.fn("CodexAppProtocolTools.readThread")(function* (
    args: Record<string, unknown>,
  ) {
    const threadId = stringArg(args.threadId);
    if (!threadId) return yield* toolError("read_thread requires threadId");
    const entry = yield* requireThread(threadId);
    const snapshot = entry.snapshot;
    if (!snapshot) return yield* toolError(`Thread '${threadId}' has no snapshot`);
    const cursor = stringArg(args.cursor);
    const limit = intArg(
      args.turnLimit,
      CODEX_APP_READ_THREAD_DEFAULT_TURN_LIMIT,
      1,
      CODEX_APP_READ_THREAD_MAX_TURN_LIMIT,
    );
    const maxOutputChars = intArg(
      args.maxOutputCharsPerItem,
      CODEX_APP_READ_THREAD_DEFAULT_MAX_OUTPUT_CHARS,
      0,
      CODEX_APP_READ_THREAD_MAX_OUTPUT_CHARS,
    );
    const cursorIndex = cursor
      ? snapshot.turns.findIndex((turn) => turn.turnId === cursor)
      : snapshot.turns.length;
    if (cursorIndex < 0)
      return yield* toolError(`Unknown cursor for thread ${threadId}: ${cursor}`);
    const preceding = snapshot.turns.slice(0, cursorIndex);
    const page = preceding
      .filter((turn): turn is typeof turn & { readonly turnId: string } => turn.turnId !== null)
      .slice(-limit)
      .reverse();
    return {
      schemaVersion: 1,
      thread: {
        id: snapshot.threadId,
        hostId: entry.durable.executionHostId,
        title: snapshot.threadName,
        preview: snapshot.threadPreview,
        status: {
          type: snapshot.statusType,
          ...(snapshot.statusActiveFlags.length > 0
            ? { activeFlags: snapshot.statusActiveFlags }
            : {}),
        },
        cwd: snapshot.cwd,
        createdAt: snapshot.createdAt,
        updatedAt: snapshot.updatedAt,
      },
      page: {
        order: "newest_first",
        limit,
        nextCursor: preceding.length > page.length ? (page.at(-1)?.turnId ?? null) : null,
        hasMore: preceding.length > page.length,
      },
      turns: page.map((turn) => ({
        id: turn.turnId,
        status: turn.status,
        error: turn.errorMessage ? { message: turn.errorMessage, additionalDetails: null } : null,
        startedAt: turn.startedAt ?? turn.turnStartedAtMs ?? null,
        firstTurnWorkItemStartedAtMs: turn.firstTurnWorkItemStartedAtMs ?? null,
        completedAt: turn.completedAt ?? null,
        durationMs: turn.durationMs ?? null,
        items: turn.items.map((item) =>
          serializeThreadItem(item, args.includeOutputs === true, maxOutputChars),
        ),
      })),
    };
  });

  const executeInfallible = (
    params: DynamicToolCallParams,
    context: CodexAppProtocolToolExecutionContext = {},
  ): Effect.Effect<DynamicToolCallResponse> =>
    Effect.gen(function* () {
      const args = asRecord(params.arguments) ?? {};
      if (!isCodexAppDynamicTool(params)) {
        return buildCodexAppDynamicToolFailure(
          `Unsupported dynamic tool namespace: ${params.namespace ?? "<none>"}`,
        );
      }
      if (params.tool === "setup_codex_step") {
        const valid =
          Object.keys(args).length === 1 &&
          (args.step === "role" ||
            args.step === "task" ||
            args.step === "context" ||
            args.step === "complete");
        if (!valid)
          return buildCodexAppDynamicToolFailure("setup_codex_step received invalid arguments.");
        return args.step === "complete"
          ? buildCodexAppDynamicToolSuccess({ completed: true })
          : buildCodexAppDynamicToolFailure(
              "setup_codex_step interactive steps must be handled by the app.",
            );
      }
      if (params.tool === AUTOMATION_UPDATE_TOOL_NAME) return yield* handleAutomation(params, args);
      if (params.tool === "read_thread_terminal") {
        const snapshot = yield* terminals.getThreadSnapshot(params.threadId);
        if (!snapshot)
          return textSuccess("No app terminal session is attached to this thread yet.");
        const lines = [
          `cwd: ${snapshot.cwd ?? "(unknown)"}`,
          `shell: ${snapshot.shell ?? "(unknown)"}`,
        ];
        if (snapshot.truncated)
          lines.push(`[showing latest ${snapshot.buffer.length.toLocaleString()} characters]`);
        lines.push("```terminal", snapshot.buffer, "```");
        return textSuccess(lines.join("\n"));
      }
      if (params.tool === "list_projects") {
        if (Object.keys(args).length > 0)
          return yield* toolError("list_projects received invalid arguments.");
        const response = yield* core.workspace.read({
          kind: "project_window",
          include_archived: false,
          window: { after: null, first: 100 },
        });
        if (response.value.kind !== "project_window")
          return yield* toolError("Core returned a non-Project window");
        return buildCodexAppDynamicToolSuccess({
          schemaVersion: 1,
          projects: response.value.projects.items.map((project) => ({
            projectId: project.id,
            projectKind: "local",
            label: project.name,
            ...(project.primary_workspace_root ? { path: project.primary_workspace_root } : {}),
            hostId: CODEX_APP_LOCAL_HOST_ID,
            hostDisplayName: CODEX_APP_LOCAL_HOST_DISPLAY_NAME,
          })),
        });
      }
      if (params.tool === "list_threads") {
        const limit = intArg(args.limit, 10, 1, 50);
        const query = stringArg(args.query) ?? "";
        const listed = query
          ? (yield* catalog.searchPalette({ query, limit })).map(({ thread }) => thread)
          : (yield* catalog.listPalette({ scope: "sidebar" })).slice(0, limit);
        return buildCodexAppDynamicToolSuccess({
          schemaVersion: 1,
          query: query || null,
          threads: listed.slice(0, limit).map((thread) => ({
            id: thread.threadId,
            hostId: CODEX_APP_LOCAL_HOST_ID,
            title: thread.title,
            preview: thread.preview,
            status: thread.statusType,
            cwd: thread.cwd,
            createdAt: thread.createdAt,
            updatedAt: thread.updatedAt,
          })),
        });
      }
      if (params.tool === "read_thread")
        return buildCodexAppDynamicToolSuccess(yield* readThread(args));
      if (params.tool === "send_message_to_thread") {
        const threadId = stringArg(args.threadId);
        const prompt = stringArg(args.prompt);
        if (!threadId || !prompt)
          return yield* toolError("send_message_to_thread requires threadId and prompt");
        yield* requireThread(threadId);
        yield* turns.start(threadId, prompt, {
          model: stringArg(args.model) ?? undefined,
          reasoningEffort: reasoningEffort(args.thinking),
        });
        return buildCodexAppDynamicToolSuccess({ threadId });
      }
      if (params.tool === "set_thread_title") {
        const threadId = stringArg(args.threadId);
        const title = stringArg(args.title);
        if (!threadId || !title)
          return yield* toolError("set_thread_title requires threadId and title");
        yield* requireThread(threadId);
        yield* titles.set({ threadId, name: title, normalization: "manual" });
        return buildCodexAppDynamicToolSuccess({ threadId, title });
      }
      if (params.tool === "set_thread_archived") {
        const threadId = stringArg(args.threadId) ?? params.threadId;
        if (typeof args.archived !== "boolean")
          return yield* toolError("set_thread_archived requires threadId and archived");
        yield* requireThread(threadId);
        yield* args.archived ? commands.archive(threadId) : commands.unarchive(threadId);
        return buildCodexAppDynamicToolSuccess({ threadId, archived: args.archived });
      }
      if (params.tool === "set_thread_pinned") {
        const threadId = stringArg(args.threadId);
        if (!threadId || typeof args.pinned !== "boolean")
          return yield* toolError("set_thread_pinned requires threadId and pinned");
        yield* catalog.setPinned(threadId, args.pinned);
        return buildCodexAppDynamicToolSuccess({ threadId, pinned: args.pinned });
      }
      if (params.tool === "fork_thread") {
        const sourceThreadId = stringArg(args.threadId) ?? params.threadId;
        const environment = asRecord(args.environment);
        if (environment?.type === "worktree") {
          const source = yield* requireThread(sourceThreadId);
          const sessionId = source.durable.sessionId;
          if (!sessionId) return yield* toolError("Worktree fork requires a Project Session");
          const forked = yield* projectSessionFork.fork({
            sessionId,
            input: { target: "newWorktree" },
            threadSource: "subagent",
          });
          if (!("pendingWorktreeId" in forked))
            return yield* toolError("Worktree fork did not create pending work");
          return buildCodexAppDynamicToolSuccess({ pendingWorktreeId: forked.pendingWorktreeId });
        }
        if (environment && environment.type !== "same-directory")
          return yield* toolError("fork_thread received invalid arguments.");
        const forked = yield* conversationFork.fork({ sourceThreadId, threadSource: "subagent" });
        return buildCodexAppDynamicToolSuccess({
          environment: { type: "same-directory" },
          sourceThreadId,
          threadId: forked.threadId,
          continuation: SAME_DIRECTORY_FORK_CONTINUATION,
        });
      }
      if (params.tool === "create_thread") {
        const input = parseCodexDynamicCreateThreadInput(args);
        if (!input) return yield* toolError("create_thread received invalid arguments.");
        const projectId = input.target.type === "project" ? input.target.projectId : null;
        if (projectId) {
          const project = yield* core.workspace.read(
            { kind: "project", project_id: projectId },
            undefined,
            projectId,
          );
          if (project.value.kind !== "project" || project.value.project.lifecycle !== "active") {
            return yield* toolError(`Project '${projectId}' was not found`);
          }
        }
        const sessionId = randomUUID();
        yield* core.workspace.apply(
          {
            operationId: `codex-app:create-thread:${params.callId}:${sessionId}`,
            intent: {
              kind: "create_session",
              session_id: sessionId,
              project_id: projectId,
              title: "New chat",
            },
          },
          undefined,
          projectId ?? undefined,
        );
        const { launch, projectlessWorkspace } = yield* Effect.gen(function* () {
          const projectlessTarget = input.target.type === "projectless" ? input.target : null;
          const projectlessWorkspace = projectlessTarget
            ? yield* Effect.tryPromise(() =>
                createCodexProjectlessWorkspace({
                  createSplitDirectories: true,
                  directoryName: projectlessTarget.directoryName,
                  prompt: input.prompt,
                }),
              )
            : undefined;
          const launch = yield* sessionLaunch.start(
            {
              projectId,
              sessionId,
              prompt: input.prompt,
              ...(projectlessWorkspace ? { projectlessWorkspace } : {}),
              model: input.model,
              reasoningEffort: reasoningEffort(input.thinking),
              permissionMode:
                context.permissionMode === "guardian-approvals" ||
                context.permissionMode === "full-access" ||
                context.permissionMode === "custom"
                  ? context.permissionMode
                  : undefined,
              serviceTier:
                context.serviceTierSelector?.type === "custom"
                  ? context.serviceTierSelector.serviceTier
                  : context.serviceTierSelector?.type === "standard"
                    ? null
                    : undefined,
              threadSource: "subagent",
              runInTarget:
                input.target.type === "project" && input.target.environment.type === "worktree"
                  ? "newWorktree"
                  : "localProject",
              ...(input.target.type === "project" && input.target.environment.type === "worktree"
                ? { worktreeStartingState: input.target.environment.startingState }
                : {}),
            },
            { browserViewScopeId: "codex-app-protocol", ownerClientId: null },
          );
          return { launch, projectlessWorkspace };
        }).pipe(
          Effect.onError(() =>
            core.workspace
              .apply(
                {
                  operationId: `codex-app:create-thread:rollback:${params.callId}:${sessionId}`,
                  intent: { kind: "delete_session", session_id: sessionId },
                },
                undefined,
                projectId ?? undefined,
              )
              .pipe(Effect.ignore),
          ),
        );
        return buildCodexAppDynamicToolSuccess(
          launch.kind === "pending"
            ? { clientThreadId: launch.clientThreadId }
            : {
                threadId: launch.detail.threadId,
                ...(projectlessWorkspace
                  ? { projectlessOutputDirectory: projectlessWorkspace.outputDirectory }
                  : {}),
              },
        );
      }
      if (params.tool === "handoff_thread") {
        const threadId = stringArg(args.threadId);
        if (!threadId) return yield* toolError("handoff_thread requires threadId");
        if (threadId === params.threadId)
          return yield* toolError("A thread cannot hand itself off. Choose another thread.");
        yield* requireThread(threadId);
        const existing = yield* handoffs.get(params.callId);
        const operation =
          existing ??
          (yield* handoffs.launch({
            operationId: params.callId || randomUUID(),
            threadId,
            destinationHostId: stringArg(args.destinationHostId),
            followUpPrompt: stringArg(args.followUpPrompt),
          }));
        return buildCodexAppDynamicToolSuccess(operation);
      }
      if (params.tool === "get_handoff_status") {
        const operationId = stringArg(args.operationId);
        if (!operationId) return yield* toolError("get_handoff_status requires operationId");
        const afterRevision =
          typeof args.afterRevision === "number" &&
          Number.isInteger(args.afterRevision) &&
          args.afterRevision >= 0
            ? args.afterRevision
            : null;
        const operation = yield* handoffs.waitForRevision(
          operationId,
          afterRevision,
          intArg(args.waitMs, 0, 0, CODEX_APP_HANDOFF_MAX_WAIT_MS),
        );
        if (!operation)
          return yield* toolError(
            `No thread handoff operation found for operationId ${operationId}.`,
          );
        return buildCodexAppDynamicToolSuccess(operation);
      }
      return buildCodexAppDynamicToolFailure(`Unsupported dynamic tool: ${params.tool}`);
    }).pipe(
      Effect.catch((cause) =>
        Effect.succeed(buildCodexAppDynamicToolFailure(failureMessage(cause))),
      ),
    );

  const service: CodexAppProtocolTools["Service"] = {
    execute: executeInfallible,
    respond: (requestId, threadId, context) =>
      Effect.sync(() =>
        pending.takeFirst(
          "dynamic-tool",
          requestId,
          (entry) =>
            entry.disposition === "dispatched" &&
            (threadId === undefined || entry.threadId === threadId) &&
            entry.request.params.namespace === CODEX_APP_TOOL_NAMESPACE,
        ),
      ).pipe(
        Effect.flatMap((entry) => {
          if (!entry) return Effect.succeed(null);
          return executeInfallible(entry.request.params, context).pipe(
            Effect.tap((response) => Effect.sync(() => pending.complete(entry, response))),
            Effect.onExit((exit) =>
              Exit.isFailure(exit)
                ? Effect.sync(() => pending.reject(entry, exit.cause))
                : Effect.void,
            ),
            Effect.map((response) => response as DynamicToolCallResponse | null),
          );
        }),
      ),
  };
  return CodexAppProtocolTools.of(service);
});
