import type { IpcApi } from "../shared/ipc-api";
import type {
  AutomationArchiveMessages,
  DesktopAutomationModulePort,
} from "./core-client/desktop-automation-module-bridge";
import type {
  CodexAutomationRunsUpdatedEvent,
  CodexHeartbeatAutomationThreadStateChangedInput,
  CodexHeartbeatAutomationsEnabledChangedInput,
  CodexScheduledAutomation,
  CodexScheduledAutomationCreateInput,
  CodexScheduledAutomationRunNowInput,
  CodexScheduledAutomationUpdateInput,
} from "../shared/types";

export type CodexScheduledAutomationIpcChannel =
  | "codex:scheduled-automations:list"
  | "codex:scheduled-automations:create"
  | "codex:scheduled-automations:update"
  | "codex:scheduled-automations:delete"
  | "codex:scheduled-automations:run-now"
  | "codex:scheduled-automations:heartbeat-enabled-changed"
  | "codex:scheduled-automations:heartbeat-thread-state-changed"
  | "codex:automation-runs:archive"
  | "codex:automation-runs:delete"
  | "codex:automation-runs:unarchive"
  | "codex:automation-runs:inbox-items"
  | "codex:automation-runs:set-read-state"
  | "codex:automation-runs:mark-all-read";

export type CodexScheduledAutomationIpcHandler<Channel extends CodexScheduledAutomationIpcChannel> =
  (
    event: unknown,
    ...args: [...IpcApi[Channel]["args"], signal?: AbortSignal]
  ) => IpcApi[Channel]["result"] | Promise<IpcApi[Channel]["result"]>;

export interface CodexScheduledAutomationIpcRegistration {
  registerHandle: <Channel extends CodexScheduledAutomationIpcChannel>(
    channel: Channel,
    listener: CodexScheduledAutomationIpcHandler<Channel>,
  ) => void;
  runScheduledAutomationNow: (
    input: CodexScheduledAutomationRunNowInput,
    rendererClientId: string | null,
    signal?: AbortSignal,
  ) => Promise<void>;
  automationModule?: DesktopAutomationModulePort;
  prepareCreateInput?: (
    input: CodexScheduledAutomationCreateInput,
  ) => Promise<CodexScheduledAutomationCreateInput>;
  prepareUpdateInput?: (
    input: CodexScheduledAutomationUpdateInput,
    current: CodexScheduledAutomation | null,
  ) => Promise<CodexScheduledAutomationUpdateInput>;
  resolveAutomationArchiveMessages: (threadId: string) => Promise<AutomationArchiveMessages>;
  unarchiveThread: (threadId: string) => Promise<unknown>;
  broadcastScheduledAutomationChanged: (
    automationId: string,
    targetThreadId: string | null,
    reason: "upsert" | "delete",
  ) => void;
  broadcastAutomationRunsUpdated: (event: CodexAutomationRunsUpdatedEvent) => void;
  onHeartbeatAutomationsEnabledChanged?: (
    input: CodexHeartbeatAutomationsEnabledChangedInput,
  ) => void;
  resolveRendererClientId?: (event: unknown) => string | null;
  onHeartbeatAutomationThreadStateChanged?: (
    input: CodexHeartbeatAutomationThreadStateChangedInput,
    rendererClientId: string | null,
  ) => void;
}

export function registerCodexScheduledAutomationIpcHandlers(
  options: CodexScheduledAutomationIpcRegistration,
): void {
  const automationModule =
    options.automationModule ??
    (new Proxy(
      {},
      {
        get: () => () => {
          throw new Error("Automation authority is unavailable before Rust Core initialization");
        },
      },
    ) as DesktopAutomationModulePort);
  const broadcastAutomationRunChanged = (
    event: CodexAutomationRunsUpdatedEvent,
    eventOptions: { refreshAutomationList?: boolean } = {},
  ) => {
    options.broadcastAutomationRunsUpdated(event);
    if (eventOptions.refreshAutomationList === false || !event.automationId) return;
    options.broadcastScheduledAutomationChanged(event.automationId, null, "upsert");
  };

  options.registerHandle("codex:scheduled-automations:list", async () => ({
    items: await automationModule.listDefinitions(),
  }));

  options.registerHandle("codex:scheduled-automations:create", async (_, input) => {
    const preparedInput = options.prepareCreateInput
      ? await options.prepareCreateInput(input)
      : input;
    const automation = await automationModule.createDefinition(preparedInput);
    options.broadcastScheduledAutomationChanged(automation.id, automation.targetThreadId, "upsert");
    return { item: automation };
  });

  options.registerHandle("codex:scheduled-automations:update", async (_, input) => {
    const current = options.prepareUpdateInput
      ? await automationModule.getDefinition(input.id)
      : null;
    const preparedInput = options.prepareUpdateInput
      ? await options.prepareUpdateInput(input, current)
      : input;
    const automation = await automationModule.updateDefinition(preparedInput);
    if (!automation) throw new Error("Scheduled automation update failed.");
    options.broadcastScheduledAutomationChanged(automation.id, automation.targetThreadId, "upsert");
    return { item: automation };
  });

  options.registerHandle("codex:scheduled-automations:delete", async (_, input) => {
    const result = await automationModule.deleteDefinition(input.id);
    if (result.success) {
      if (result.deletedRunCount > 0) {
        options.broadcastAutomationRunsUpdated({
          automationId: result.item?.id ?? input.id,
          threadId: null,
          reason: "delete",
        });
      }
      options.broadcastScheduledAutomationChanged(
        result.item?.id ?? input.id,
        result.item?.targetThreadId ?? null,
        "delete",
      );
    }
    return {
      item: result.item,
      success: result.success,
      status: result.status,
    };
  });

  options.registerHandle("codex:scheduled-automations:run-now", async (event, input, signal) => {
    await options.runScheduledAutomationNow(
      input,
      options.resolveRendererClientId?.(event) ?? null,
      signal,
    );
    return { success: true };
  });

  options.registerHandle("codex:scheduled-automations:heartbeat-enabled-changed", (_, input) => {
    options.onHeartbeatAutomationsEnabledChanged?.(input);
    return { success: true };
  });

  options.registerHandle(
    "codex:scheduled-automations:heartbeat-thread-state-changed",
    (event, input) => {
      options.onHeartbeatAutomationThreadStateChanged?.(
        input,
        options.resolveRendererClientId?.(event) ?? null,
      );
      return { success: true };
    },
  );

  options.registerHandle("codex:automation-runs:archive", async (_, input) => {
    const run = await automationModule.getRun(input.threadId);
    const messages =
      input.archivedAssistantMessage != null || input.archivedUserMessage != null
        ? {
            archivedAssistantMessage: input.archivedAssistantMessage ?? null,
            archivedUserMessage: input.archivedUserMessage ?? null,
          }
        : await options.resolveAutomationArchiveMessages(input.threadId);
    const success = await automationModule.archiveRun(input, messages);
    if (run && success) {
      broadcastAutomationRunChanged({
        automationId: run.automationId,
        threadId: input.threadId,
        reason: "archive",
      });
    }
    return {
      success,
    };
  });

  options.registerHandle("codex:automation-runs:delete", async (_, input) => {
    const run = await automationModule.getRun(input.threadId);
    const success = await automationModule.deleteRun(input.threadId);
    if (success && run) {
      broadcastAutomationRunChanged({
        automationId: run.automationId,
        threadId: input.threadId,
        reason: "delete",
      });
    }
    return { success };
  });

  options.registerHandle("codex:automation-runs:unarchive", async (_, input) => {
    const run = await automationModule.getRun(input.threadId);
    await options.unarchiveThread(input.threadId);
    const success = await automationModule.unarchiveRun(input.threadId);
    if (success && run) {
      broadcastAutomationRunChanged({
        automationId: run.automationId,
        threadId: input.threadId,
        reason: "unarchive",
      });
    }
    return { success };
  });

  options.registerHandle("codex:automation-runs:inbox-items", (_, limit) =>
    automationModule.readInbox(limit ?? 200),
  );

  options.registerHandle("codex:automation-runs:set-read-state", async (_, input) => {
    const item = await automationModule.setRunReadState(input);
    if (item) {
      broadcastAutomationRunChanged({
        automationId: item.automationId,
        threadId: input.threadId,
        reason: "read-state",
      });
    }
    return item;
  });

  options.registerHandle("codex:automation-runs:mark-all-read", async (_, input) => {
    const changedCount = await automationModule.markAllRunsRead(input);
    if (changedCount > 0) {
      options.broadcastAutomationRunsUpdated({
        automationId: null,
        threadId: null,
        reason: "mark-all-read",
      });
    }
    return { changedCount };
  });
}
