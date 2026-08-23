import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import type { IpcMainInvokeEvent } from "electron";
import type { IpcApi } from "../../../shared/ipc-api";
import type {
  CodexAutomationRunsUpdatedEvent,
  PageOccurrenceActionInput,
  PageOccurrenceCompleteInput,
  PageOccurrenceUpdateInput,
} from "../../../shared/types";
import { MainConfig } from "../../app/MainConfig";
import { AutomationApplication } from "../../automation-application/AutomationApplication";
import { ConversationCommands } from "../../codex-application/ConversationCommands";
import type { CodexService } from "../../codex/codex-service";
import type { RendererClientRuntimeService } from "../../codex/renderer-client-runtime-contracts";
import { ScheduledAutomationRuntime } from "../../host-runtime/ScheduledAutomationRuntime";
import { safeBroadcastToWindows } from "../../ipc-safe-send";
import { ElectronIpc } from "../../platform/electron/ElectronIpc";
import { requireTrustedAppRendererSender } from "../../platform/electron/TrustedRendererSender";
import { WindowRuntime } from "../../window-runtime/WindowRuntime";

export interface AutomationIpcOptions {
  readonly codex: CodexService;
  readonly rendererClients: RendererClientRuntimeService;
}

export class AutomationIpcError extends Schema.TaggedError<AutomationIpcError>()(
  "AutomationIpcError",
  { operation: Schema.String, cause: Schema.Defect() },
) {}

type Handler<Channel extends keyof IpcApi> = (
  event: IpcMainInvokeEvent,
  ...args: IpcApi[Channel]["args"]
) => Effect.Effect<IpcApi[Channel]["result"], unknown>;

const requireOccurrence = (input: PageOccurrenceActionInput): void => {
  if (
    typeof input?.operationId !== "string" ||
    input.operationId.length === 0 ||
    input.operationId.length > 512 ||
    input.operationId !== input.operationId.trim()
  ) {
    throw new Error("Missing or invalid occurrence operationId");
  }
  if (typeof input.pageId !== "string" || input.pageId.length === 0) {
    throw new Error("Missing or invalid occurrence pageId");
  }
  if (
    !(input.occurrenceStart instanceof Date) ||
    !Number.isFinite(input.occurrenceStart.getTime())
  ) {
    throw new Error("Missing or invalid occurrenceStart");
  }
  if (
    input.source !== "calendar" &&
    input.source !== "page-detail" &&
    input.source !== "notification" &&
    input.source !== "api"
  ) {
    throw new Error("Missing or invalid occurrence source");
  }
};

const requireCompleteOccurrence = (input: PageOccurrenceCompleteInput): void => {
  requireOccurrence(input);
  if (
    typeof input.createdPageId !== "string" ||
    input.createdPageId.length === 0 ||
    input.createdPageId !== input.createdPageId.trim()
  ) {
    throw new Error("Missing or invalid occurrence createdPageId");
  }
};

const requireUpdateOccurrence = (input: PageOccurrenceUpdateInput): void => {
  requireOccurrence(input);
  if (input.scope !== "this" && input.scope !== "this-and-future" && input.scope !== "all") {
    throw new Error("Missing or invalid occurrence scope");
  }
  if (input.scope === "all" && "createdPageId" in input) {
    throw new Error("Occurrence scope all must not include createdPageId");
  }
  if (
    input.scope !== "all" &&
    (typeof input.createdPageId !== "string" ||
      input.createdPageId.length === 0 ||
      input.createdPageId !== input.createdPageId.trim())
  ) {
    throw new Error("Missing or invalid occurrence createdPageId");
  }
  if (typeof input.updates !== "object" || input.updates === null || Array.isArray(input.updates)) {
    throw new Error("Missing or invalid occurrence updates");
  }
};

export const live = (
  options: AutomationIpcOptions,
): Layer.Layer<
  never,
  never,
  | AutomationApplication
  | ConversationCommands
  | ElectronIpc
  | MainConfig
  | ScheduledAutomationRuntime
  | WindowRuntime
> =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const automation = yield* AutomationApplication;
      const conversationCommands = yield* ConversationCommands;
      const config = yield* MainConfig;
      const ipc = yield* ElectronIpc;
      const scheduledAutomations = yield* ScheduledAutomationRuntime;
      const windows = yield* WindowRuntime;
      const handle = <Channel extends keyof IpcApi>(channel: Channel, handler: Handler<Channel>) =>
        ipc.handle(channel, handler);
      const authorize = (event: IpcMainInvokeEvent) =>
        Effect.try({
          try: () => {
            requireTrustedAppRendererSender(event, "Automation", config.rendererUrl);
            if (!windows.has(event.sender.id)) {
              throw new Error("Automation access requires an active Nodex window");
            }
            return options.rendererClients.ensureClient(event.sender).clientId;
          },
          catch: (cause) => new AutomationIpcError({ operation: "authorize-renderer", cause }),
        });
      const run = <A, E>(operation: string, task: Effect.Effect<A, E>) =>
        task.pipe(Effect.mapError((cause) => new AutomationIpcError({ operation, cause })));
      const fromCodex = <A>(operation: string, task: (signal: AbortSignal) => Promise<A>) =>
        Effect.tryPromise({
          try: task,
          catch: (cause) => new AutomationIpcError({ operation, cause }),
        });
      const invoke = <Channel extends keyof IpcApi, E>(
        channel: Channel,
        task: (
          event: IpcMainInvokeEvent,
          ...args: IpcApi[Channel]["args"]
        ) => Effect.Effect<IpcApi[Channel]["result"], E>,
      ) =>
        handle(channel, (event, ...args) =>
          authorize(event).pipe(Effect.andThen(run(channel, task(event, ...args)))),
        );

      yield* invoke("calendar:occurrences", (_, projectId, start, end, query, after) =>
        automation.occurrences
          .list({ projectId, windowStart: start, windowEnd: end, searchQuery: query, after })
          .pipe(
            Effect.map((window) => ({
              occurrences: [...window.items],
              nextCursor: window.nextCursor,
            })),
          ),
      );
      yield* invoke("page:occurrence:complete", (_, projectId, input) => {
        requireCompleteOccurrence(input);
        return automation.occurrences.complete(projectId, input);
      });
      yield* invoke("page:occurrence:skip", (_, projectId, input) => {
        requireOccurrence(input);
        return automation.occurrences.skip(projectId, input);
      });
      yield* invoke("page:occurrence:update", (_, projectId, input) => {
        requireUpdateOccurrence(input);
        return automation.occurrences.update(projectId, input);
      });

      const broadcastDefinitionChanged = (
        automationId: string,
        targetThreadId: string | null,
        reason: "upsert" | "delete",
      ) =>
        Effect.sync(() => {
          safeBroadcastToWindows(windows.all(), "codex:scheduled-automations:changed", [
            { automationId, targetThreadId, reason },
          ]);
        });
      const broadcastRunsUpdated = (event: CodexAutomationRunsUpdatedEvent) =>
        Effect.sync(() => {
          safeBroadcastToWindows(windows.all(), "codex:automation-runs:updated", [event]);
        });
      const broadcastRunChanged = (
        event: CodexAutomationRunsUpdatedEvent,
        refreshDefinition = true,
      ) =>
        broadcastRunsUpdated(event).pipe(
          Effect.andThen(
            refreshDefinition && event.automationId
              ? broadcastDefinitionChanged(event.automationId, null, "upsert")
              : Effect.void,
          ),
        );

      yield* invoke("codex:scheduled-automations:list", () =>
        automation.definitions.list().pipe(Effect.map((items) => ({ items: [...items] }))),
      );
      yield* invoke("codex:scheduled-automations:create", (_, input) =>
        fromCodex("prepare-scheduled-automation-create", () =>
          options.codex.prepareScheduledAutomationInput(input),
        ).pipe(
          Effect.flatMap(automation.definitions.create),
          Effect.tap((item) => broadcastDefinitionChanged(item.id, item.targetThreadId, "upsert")),
          Effect.map((item) => ({ item })),
        ),
      );
      yield* invoke("codex:scheduled-automations:update", (_, input) =>
        automation.definitions.get(input.id).pipe(
          Effect.flatMap((current) =>
            fromCodex("prepare-scheduled-automation-update", () =>
              options.codex.prepareScheduledAutomationInput(input, current),
            ),
          ),
          Effect.flatMap(automation.definitions.update),
          Effect.flatMap((item) =>
            item
              ? broadcastDefinitionChanged(item.id, item.targetThreadId, "upsert").pipe(
                  Effect.as({ item }),
                )
              : Effect.fail(
                  new AutomationIpcError({
                    operation: "codex:scheduled-automations:update",
                    cause: new Error("Scheduled automation update failed."),
                  }),
                ),
          ),
        ),
      );
      yield* invoke("codex:scheduled-automations:delete", (_, input) =>
        automation.definitions.delete(input.id).pipe(
          Effect.tap((result) =>
            result.success
              ? Effect.all(
                  [
                    result.deletedRunCount > 0
                      ? broadcastRunsUpdated({
                          automationId: result.item?.id ?? input.id,
                          threadId: null,
                          reason: "delete",
                        })
                      : Effect.void,
                    broadcastDefinitionChanged(
                      result.item?.id ?? input.id,
                      result.item?.targetThreadId ?? null,
                      "delete",
                    ),
                  ],
                  { discard: true },
                )
              : Effect.void,
          ),
          Effect.map((result) => ({
            item: result.item,
            success: result.success,
            status: result.status,
          })),
        ),
      );
      yield* invoke("codex:scheduled-automations:run-now", (event, input) =>
        fromCodex("codex:scheduled-automations:run-now", (signal) =>
          options.codex.runScheduledAutomationNow(
            input,
            options.rendererClients.ensureClient(event.sender).clientId,
            signal,
          ),
        ).pipe(Effect.as({ success: true })),
      );
      yield* invoke("codex:scheduled-automations:heartbeat-enabled-changed", (_, input) =>
        scheduledAutomations
          .setHeartbeatAutomationsEnabled(input.enabled)
          .pipe(Effect.as({ success: true })),
      );
      yield* invoke("codex:scheduled-automations:heartbeat-thread-state-changed", (event, input) =>
        scheduledAutomations
          .setHeartbeatThreadRendererState({
            ...input,
            rendererClientId: options.rendererClients.ensureClient(event.sender).clientId,
          })
          .pipe(Effect.as({ success: true })),
      );
      yield* invoke("codex:automation-runs:archive", (_, input) =>
        Effect.all({
          run: automation.runs.get(input.threadId),
          messages:
            input.archivedAssistantMessage != null || input.archivedUserMessage != null
              ? Effect.succeed({
                  archivedAssistantMessage: input.archivedAssistantMessage ?? null,
                  archivedUserMessage: input.archivedUserMessage ?? null,
                })
              : fromCodex("resolve-automation-archive-messages", () =>
                  options.codex.resolveAutomationArchiveMessages(input.threadId),
                ),
        }).pipe(
          Effect.flatMap(({ run: item, messages }) =>
            automation.runs.archive({ ...input, ...messages }).pipe(
              Effect.tap((success) =>
                item && success
                  ? broadcastRunChanged({
                      automationId: item.automationId,
                      threadId: input.threadId,
                      reason: "archive",
                    })
                  : Effect.void,
              ),
              Effect.map((success) => ({ success })),
            ),
          ),
        ),
      );
      yield* invoke("codex:automation-runs:delete", (_, input) =>
        automation.runs.get(input.threadId).pipe(
          Effect.flatMap((item) =>
            automation.runs.delete(input.threadId).pipe(
              Effect.tap((success) =>
                success && item
                  ? broadcastRunChanged({
                      automationId: item.automationId,
                      threadId: input.threadId,
                      reason: "delete",
                    })
                  : Effect.void,
              ),
              Effect.map((success) => ({ success })),
            ),
          ),
        ),
      );
      yield* invoke("codex:automation-runs:unarchive", (_, input) =>
        automation.runs.get(input.threadId).pipe(
          Effect.flatMap((item) =>
            conversationCommands.unarchive(input.threadId).pipe(
              Effect.andThen(automation.runs.unarchive(input.threadId)),
              Effect.tap((success) =>
                success && item
                  ? broadcastRunChanged({
                      automationId: item.automationId,
                      threadId: input.threadId,
                      reason: "unarchive",
                    })
                  : Effect.void,
              ),
              Effect.map((success) => ({ success })),
            ),
          ),
        ),
      );
      yield* invoke("codex:automation-runs:inbox-items", (_, limit) =>
        automation.inbox.read(limit ?? 200),
      );
      yield* invoke("codex:automation-runs:set-read-state", (_, input) =>
        automation.inbox.setReadState(input).pipe(
          Effect.tap((item) =>
            item
              ? broadcastRunChanged({
                  automationId: item.automationId,
                  threadId: input.threadId,
                  reason: "read-state",
                })
              : Effect.void,
          ),
        ),
      );
      yield* invoke("codex:automation-runs:mark-all-read", () =>
        automation.inbox.markAllRead.pipe(
          Effect.tap((changedCount) =>
            changedCount > 0
              ? broadcastRunsUpdated({
                  automationId: null,
                  threadId: null,
                  reason: "mark-all-read",
                })
              : Effect.void,
          ),
          Effect.map((changedCount) => ({ changedCount })),
        ),
      );
    }),
  );
