import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import type { IpcMainInvokeEvent } from "electron";
import type { IpcApi } from "../../../shared/ipc-api";
import type {
  CodexHeartbeatAutomationThreadStateChangedInput,
  CodexHeartbeatAutomationsEnabledChangedInput,
  PageOccurrenceActionInput,
  PageOccurrenceCompleteInput,
  PageOccurrenceUpdateInput,
} from "../../../shared/types";
import { MainConfig } from "../../app/MainConfig";
import type { ConversationCommandsPromiseAdapter } from "../../codex-application/ConversationCommandsPromiseAdapter";
import type { CodexService } from "../../codex/codex-service";
import type { RendererClientRuntimeService } from "../../codex/renderer-client-runtime-contracts";
import {
  registerCodexScheduledAutomationIpcHandlers,
  type CodexScheduledAutomationIpcChannel,
  type CodexScheduledAutomationIpcHandler,
} from "../../codex-scheduled-automation-ipc-handlers";
import type { DesktopAutomationModulePort } from "../../core-client/desktop-automation-module-bridge";
import { safeBroadcastToWindows } from "../../ipc-safe-send";
import { ElectronIpc } from "../../platform/electron/ElectronIpc";
import { requireTrustedAppRendererSender } from "../../platform/electron/TrustedRendererSender";
import { WindowRuntime } from "../../window-runtime/WindowRuntime";

export interface AutomationIpcOptions {
  readonly automation: DesktopAutomationModulePort;
  readonly codex: CodexService;
  readonly conversationCommands: Pick<ConversationCommandsPromiseAdapter, "unarchive">;
  readonly rendererClients: RendererClientRuntimeService;
  readonly onHeartbeatAutomationsEnabledChanged: (
    input: CodexHeartbeatAutomationsEnabledChangedInput,
  ) => void;
  readonly onHeartbeatAutomationThreadStateChanged: (
    input: CodexHeartbeatAutomationThreadStateChangedInput,
    rendererClientId: string,
  ) => void;
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
): Layer.Layer<never, never, ElectronIpc | MainConfig | WindowRuntime> =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const config = yield* MainConfig;
      const ipc = yield* ElectronIpc;
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
      const run = <A>(operation: string, task: (signal: AbortSignal) => A | Promise<A>) =>
        Effect.tryPromise({
          try: (signal) => Promise.resolve(task(signal)),
          catch: (cause) => new AutomationIpcError({ operation, cause }),
        });
      const invoke = <Channel extends keyof IpcApi>(
        channel: Channel,
        task: (
          event: IpcMainInvokeEvent,
          ...args: IpcApi[Channel]["args"]
        ) => IpcApi[Channel]["result"] | Promise<IpcApi[Channel]["result"]>,
      ) =>
        handle(channel, (event, ...args) =>
          authorize(event).pipe(Effect.andThen(run(channel, () => task(event, ...args)))),
        );

      yield* invoke("calendar:occurrences", async (_, projectId, start, end, query, after) => {
        const window = await options.automation.listPageOccurrences(
          projectId,
          start,
          end,
          query,
          after,
        );
        return { occurrences: [...window.items], nextCursor: window.nextCursor };
      });
      yield* invoke("page:occurrence:complete", (_, projectId, input, sessionId) => {
        requireCompleteOccurrence(input);
        return options.automation.completePageOccurrence(projectId, input, sessionId);
      });
      yield* invoke("page:occurrence:skip", (_, projectId, input, sessionId) => {
        requireOccurrence(input);
        return options.automation.skipPageOccurrence(projectId, input, sessionId);
      });
      yield* invoke("page:occurrence:update", (_, projectId, input, sessionId) => {
        requireUpdateOccurrence(input);
        return options.automation.updatePageOccurrence(projectId, input, sessionId);
      });

      const registrations: Array<Effect.Effect<void, never, Scope.Scope>> = [];
      const install = <Channel extends CodexScheduledAutomationIpcChannel>(
        channel: Channel,
        handler: CodexScheduledAutomationIpcHandler<Channel>,
      ) =>
        ipc.handle(channel, (event, ...args) =>
          authorize(event).pipe(
            Effect.andThen(
              run(channel, (signal) => Reflect.apply(handler, undefined, [event, ...args, signal])),
            ),
          ),
        );
      registerCodexScheduledAutomationIpcHandlers({
        registerHandle: (channel, handler) => {
          registrations.push(install(channel, handler));
        },
        automationModule: options.automation,
        prepareCreateInput: (input) => options.codex.prepareScheduledAutomationInput(input),
        prepareUpdateInput: (input, current) =>
          options.codex.prepareScheduledAutomationInput(input, current),
        runScheduledAutomationNow: (input, clientId, signal) =>
          options.codex.runScheduledAutomationNow(input, clientId, signal),
        resolveAutomationArchiveMessages: (threadId) =>
          options.codex.resolveAutomationArchiveMessages(threadId),
        unarchiveThread: options.conversationCommands.unarchive,
        broadcastScheduledAutomationChanged: (automationId, targetThreadId, reason) => {
          safeBroadcastToWindows(windows.all(), "codex:scheduled-automations:changed", [
            { automationId, targetThreadId, reason },
          ]);
        },
        broadcastAutomationRunsUpdated: (event) => {
          safeBroadcastToWindows(windows.all(), "codex:automation-runs:updated", [event]);
        },
        onHeartbeatAutomationsEnabledChanged: options.onHeartbeatAutomationsEnabledChanged,
        resolveRendererClientId: (event) =>
          options.rendererClients.ensureClient((event as IpcMainInvokeEvent).sender).clientId,
        onHeartbeatAutomationThreadStateChanged: (input, clientId) => {
          if (clientId) options.onHeartbeatAutomationThreadStateChanged(input, clientId);
        },
      });
      yield* Effect.all(registrations, { discard: true });
    }),
  );
