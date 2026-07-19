import { randomUUID } from "node:crypto";

import type {
  CodexAutomationInboxItem,
  CodexAutomationRun,
  CodexAutomationRunArchiveInput,
  CodexAutomationRunMarkAllReadInput,
  CodexAutomationRunReadStateInput,
  CodexAutomationRunsInboxResponse,
  CodexScheduledAutomation,
  CodexScheduledAutomationCreateInput,
  CodexScheduledAutomationDeleteResponse,
  CodexScheduledAutomationUpdateInput,
} from "../../shared/types";
import type { DesktopDataAuthorityRuntime } from "./desktop-data-authority";
import type {
  AutomationCommittedValue,
  AutomationReadSnapshot,
  CoreClientPort,
} from "./types";

type CoreAutomationDefinition = Extract<
  AutomationReadSnapshot["value"],
  { readonly kind: "definitions" }
>["items"][number];

type CoreAutomationRun = Extract<
  AutomationReadSnapshot["value"],
  { readonly kind: "runs" }
>["items"][number];

type CoreAutomationInboxItem = Extract<
  AutomationReadSnapshot["value"],
  { readonly kind: "inbox" }
>["items"][number];

export interface AutomationArchiveMessages {
  readonly archivedUserMessage: string | null;
  readonly archivedAssistantMessage: string | null;
}

export interface DesktopAutomationDefinitionDeleteResult
  extends CodexScheduledAutomationDeleteResponse {
  readonly deletedRunCount: number;
}

export interface DesktopAutomationModulePort {
  listDefinitions(): Promise<CodexScheduledAutomation[]>;
  createDefinition(
    input: CodexScheduledAutomationCreateInput,
  ): Promise<CodexScheduledAutomation>;
  updateDefinition(
    input: CodexScheduledAutomationUpdateInput,
  ): Promise<CodexScheduledAutomation | null>;
  deleteDefinition(id: string): Promise<DesktopAutomationDefinitionDeleteResult>;
  getRun(threadId: string): Promise<CodexAutomationRun | null>;
  archiveRun(
    input: CodexAutomationRunArchiveInput,
    messages: AutomationArchiveMessages,
  ): Promise<boolean>;
  deleteRun(threadId: string): Promise<boolean>;
  unarchiveRun(threadId: string): Promise<boolean>;
  readInbox(limit?: number): Promise<CodexAutomationRunsInboxResponse>;
  setRunReadState(
    input: CodexAutomationRunReadStateInput,
  ): Promise<CodexAutomationInboxItem | null>;
  markAllRunsRead(input: CodexAutomationRunMarkAllReadInput): Promise<number>;
}

export interface DesktopAutomationModuleBridgeInput {
  readonly authority: Promise<DesktopDataAuthorityRuntime>;
  readonly typescript: DesktopAutomationModulePort;
}

const mapDefinition = (
  definition: CoreAutomationDefinition,
): CodexScheduledAutomation => ({
  id: definition.automation_id,
  kind: definition.kind,
  status: definition.status,
  targetThreadId: definition.target_thread_id ?? null,
  name: definition.name,
  prompt: definition.prompt,
  rrule: definition.rrule || null,
  model: definition.model ?? null,
  reasoningEffort: definition.reasoning_effort ?? null,
  cwds: [...definition.cwds],
  executionEnvironment: definition.execution_environment,
  localEnvironmentConfigPath:
    definition.local_environment_config_path ?? null,
  nextRunAt: definition.next_run_at_ms ?? null,
  lastRunAt: definition.last_run_at_ms ?? null,
  createdAt: definition.created_at_ms,
  updatedAt: definition.updated_at_ms,
});

const mapRun = (run: CoreAutomationRun): CodexAutomationRun => ({
  threadId: run.thread_id,
  automationId: run.automation_id,
  status: run.status,
  readAt: run.read_at_ms ?? null,
  threadTitle: run.thread_title ?? null,
  sourceCwd: run.source_cwd ?? null,
  inboxTitle: run.inbox_title ?? null,
  inboxSummary: run.inbox_summary ?? null,
  archivedUserMessage: run.archived_user_message ?? null,
  archivedAssistantMessage: run.archived_assistant_message ?? null,
  archivedReason: run.archived_reason ?? null,
  createdAt: run.created_at_ms,
  updatedAt: run.updated_at_ms,
});

const mapInboxItem = (
  item: CoreAutomationInboxItem,
): CodexAutomationInboxItem => ({
  id: item.thread_id,
  automationId: item.automation_id,
  automationName: item.automation_name ?? null,
  title: item.title ?? null,
  description: item.description ?? null,
  archivedAssistantMessage: item.archived_assistant_message ?? null,
  archivedUserMessage: item.archived_user_message ?? null,
  archivedReason: item.archived_reason ?? null,
  sourceCwd: item.source_cwd ?? null,
  threadId: item.thread_id,
  readAt: item.read_at_ms ?? null,
  createdAt: item.created_at_ms,
  status: item.status,
});

const toCoreDefinitionInput = (
  input: CodexScheduledAutomationCreateInput,
) => ({
  kind: input.kind,
  target_thread_id: input.targetThreadId ?? null,
  name: input.name,
  prompt: input.prompt ?? null,
  rrule: input.rrule ?? null,
  model: input.model ?? null,
  reasoning_effort: input.reasoningEffort ?? null,
  cwds: input.cwds ?? null,
  execution_environment: input.executionEnvironment ?? null,
  local_environment_config_path: input.localEnvironmentConfigPath ?? null,
});

const operationId = (kind: string): string =>
  `electron:automation:${kind}:${randomUUID()}`;

const slugifyAutomationName = (name: string): string =>
  name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");

const createAutomationId = (
  name: string,
  existingIds: ReadonlySet<string>,
): string => {
  const base = slugifyAutomationName(name) || "automation";
  if (!existingIds.has(base)) return base;
  for (let suffix = 2; suffix <= 20; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!existingIds.has(candidate)) return candidate;
  }
  return `${base}-${randomUUID().slice(0, 8)}`;
};

const requireDefinition = (
  committed: AutomationCommittedValue,
  automationId: string,
): CoreAutomationDefinition => {
  const definition = committed.value.definitions.find((candidate) =>
    candidate.automation_id === automationId
  );
  if (definition) return definition;
  throw new Error("Core Automation commit omitted its Definition result");
};

const requireRun = (
  committed: AutomationCommittedValue,
  threadId: string,
): CoreAutomationRun => {
  const run = committed.value.runs.find((candidate) =>
    candidate.thread_id === threadId
  );
  if (run) return run;
  throw new Error("Core Automation commit omitted its Run result");
};

const createCoreAutomationPort = (
  client: CoreClientPort,
): DesktopAutomationModulePort => {
  const readDefinition = async (
    automationId: string,
  ): Promise<CoreAutomationDefinition | null> => {
    const snapshot = await client.automationRead({
      kind: "definition",
      automation_id: automationId,
    });
    if (snapshot.value.kind !== "definition") {
      throw new Error("Core returned a non-Definition Automation read");
    }
    return snapshot.value.item ?? null;
  };
  const readRun = async (threadId: string): Promise<CoreAutomationRun | null> => {
    const snapshot = await client.automationRead({
      kind: "run",
      thread_id: threadId,
    });
    if (snapshot.value.kind !== "run") {
      throw new Error("Core returned a non-Run Automation read");
    }
    return snapshot.value.item ?? null;
  };
  const applyRun = async (
    threadId: string,
    intent: (run: CoreAutomationRun) => Parameters<CoreClientPort["automationApply"]>[0]["intent"],
  ): Promise<CoreAutomationRun | null> => {
    const run = await readRun(threadId);
    if (!run) return null;
    const committed = await client.automationApply({
      operationId: operationId(`run:${threadId}`),
      intent: intent(run),
    });
    return requireRun(committed, threadId);
  };

  return {
    listDefinitions: async () => {
      const snapshot = await client.automationRead({
        kind: "definitions",
        include_deleted: false,
      });
      if (snapshot.value.kind !== "definitions") {
        throw new Error("Core returned a non-Definitions Automation read");
      }
      return snapshot.value.items.map(mapDefinition);
    },
    createDefinition: async (input) => {
      const definitions = await client.automationRead({
        kind: "definitions",
        include_deleted: true,
      });
      if (definitions.value.kind !== "definitions") {
        throw new Error("Core returned a non-Definitions Automation read");
      }
      const automationId = createAutomationId(
        input.name,
        new Set(
          definitions.value.items.map((definition) =>
            definition.automation_id
          ),
        ),
      );
      const committed = await client.automationApply({
        operationId: operationId(`create:${automationId}`),
        intent: {
          kind: "create_definition",
          automation_id: automationId,
          definition: toCoreDefinitionInput(input),
        },
      });
      return mapDefinition(requireDefinition(committed, automationId));
    },
    updateDefinition: async (input) => {
      const current = await readDefinition(input.id);
      if (!current) return null;
      const committed = await client.automationApply({
        operationId: operationId(`update:${input.id}`),
        intent: input.status === "DELETED"
          ? {
              kind: "delete_definition",
              automation_id: input.id,
              expected_revision: current.definition_revision,
            }
          : {
              kind: "update_definition",
              automation_id: input.id,
              expected_revision: current.definition_revision,
              status: input.status,
              definition: toCoreDefinitionInput(input),
            },
      });
      return mapDefinition(requireDefinition(committed, input.id));
    },
    deleteDefinition: async (id) => {
      const current = await readDefinition(id);
      if (!current) {
        return {
          item: null,
          success: true,
          status: "not_found",
          deletedRunCount: 0,
        };
      }
      const committed = await client.automationApply({
        operationId: operationId(`delete:${id}`),
        intent: {
          kind: "delete_definition",
          automation_id: id,
          expected_revision: current.definition_revision,
        },
      });
      return {
        item: mapDefinition(current),
        success: true,
        status: "deleted",
        deletedRunCount: committed.value.deleted_run_ids.length,
      };
    },
    getRun: async (threadId) => {
      const run = await readRun(threadId);
      return run ? mapRun(run) : null;
    },
    archiveRun: async (input, messages) =>
      (await applyRun(input.threadId, (run) => ({
        kind: "archive_run",
        thread_id: input.threadId,
        expected_revision: run.run_revision,
        archived_user_message: messages.archivedUserMessage,
        archived_assistant_message: messages.archivedAssistantMessage,
        archived_reason: input.archivedReason ?? null,
      }))) !== null,
    deleteRun: async (threadId) => {
      const run = await readRun(threadId);
      if (!run) return false;
      const committed = await client.automationApply({
        operationId: operationId(`delete-run:${threadId}`),
        intent: {
          kind: "delete_run",
          thread_id: threadId,
          expected_revision: run.run_revision,
        },
      });
      return committed.value.deleted_run_ids.includes(threadId);
    },
    unarchiveRun: async (threadId) =>
      (await applyRun(threadId, (run) => ({
        kind: "unarchive_run",
        thread_id: threadId,
        expected_revision: run.run_revision,
      }))) !== null,
    readInbox: async (limit) => {
      const snapshot = await client.automationRead({
        kind: "inbox",
        limit: limit ?? null,
      });
      if (snapshot.value.kind !== "inbox") {
        throw new Error("Core returned a non-Inbox Automation read");
      }
      return {
        items: snapshot.value.items.map(mapInboxItem),
        unreadRunCounts: {
          total: snapshot.value.unread_counts.total,
          automationIds: [...snapshot.value.unread_counts.automation_ids],
          unreadRuns: snapshot.value.unread_counts.unread_runs.map((run) => ({
            automationId: run.automation_id,
            threadId: run.thread_id,
          })),
        },
      };
    },
    setRunReadState: async (input) => {
      const run = await applyRun(input.threadId, (current) => ({
        kind: "set_run_read_state",
        thread_id: input.threadId,
        expected_revision: current.run_revision,
        read: input.readAt !== null,
      }));
      if (!run) return null;
      const inbox = await client.automationRead({
        kind: "inbox",
        limit: 200,
      });
      if (inbox.value.kind !== "inbox") {
        throw new Error("Core returned a non-Inbox Automation read");
      }
      const item = inbox.value.items.find((candidate) =>
        candidate.thread_id === input.threadId
      );
      return item ? mapInboxItem(item) : null;
    },
    markAllRunsRead: async () => {
      const committed = await client.automationApply({
        operationId: operationId("mark-all-read"),
        intent: { kind: "mark_all_runs_read" },
      });
      return committed.value.run_bulk?.changed_count ?? 0;
    },
  };
};

export const createDesktopAutomationModuleBridge = (
  input: DesktopAutomationModuleBridgeInput,
): DesktopAutomationModulePort => {
  let corePort: DesktopAutomationModulePort | null = null;
  const port = async (): Promise<DesktopAutomationModulePort> => {
    const runtime = await input.authority;
    if (runtime.backend === "typescript") return input.typescript;
    corePort ??= createCoreAutomationPort(runtime.rootClient);
    return corePort;
  };
  return {
    listDefinitions: async () => (await port()).listDefinitions(),
    createDefinition: async (definition) =>
      (await port()).createDefinition(definition),
    updateDefinition: async (definition) =>
      (await port()).updateDefinition(definition),
    deleteDefinition: async (id) => (await port()).deleteDefinition(id),
    getRun: async (threadId) => (await port()).getRun(threadId),
    archiveRun: async (archiveInput, messages) =>
      (await port()).archiveRun(archiveInput, messages),
    deleteRun: async (threadId) => (await port()).deleteRun(threadId),
    unarchiveRun: async (threadId) => (await port()).unarchiveRun(threadId),
    readInbox: async (limit) => (await port()).readInbox(limit),
    setRunReadState: async (readInput) =>
      (await port()).setRunReadState(readInput),
    markAllRunsRead: async (readInput) =>
      (await port()).markAllRunsRead(readInput),
  };
};
