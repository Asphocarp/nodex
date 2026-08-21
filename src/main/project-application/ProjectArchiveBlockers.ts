import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type {
  CodexCanonicalConversationState,
  CodexCanonicalItem,
} from "../../shared/codex-conversation-state/codex-conversation-state";
import type {
  CodexConversationSnapshot,
  ProjectArchiveBlocker,
  ProjectSessionSummary,
} from "../../shared/types";
import {
  CodexBackgroundProcesses,
  type CodexBackgroundProcessesError,
} from "../codex-application/CodexBackgroundProcesses";
import { ConversationRuntimeMap } from "../codex-application/ConversationRuntimeMap";
import { TerminalSessions } from "../terminal-runtime/TerminalSessions";

export interface ProjectArchiveOwnership {
  readonly sessions: readonly ProjectSessionSummary[];
}

export class ProjectArchiveBlockers extends Context.Service<
  ProjectArchiveBlockers,
  {
    /** Reads every live activity owner that makes a Project archive unsafe. */
    readonly list: (
      ownership: ProjectArchiveOwnership,
    ) => Effect.Effect<readonly ProjectArchiveBlocker[], CodexBackgroundProcessesError>;
  }
>()("nodex/main/project-application/ProjectArchiveBlockers") {}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;

const hasRunningAgentState = (value: unknown): boolean => {
  const record = asRecord(value);
  if (!record) return false;
  if (record.status === "running") return true;
  const agentStates = asRecord(record.agentsStates);
  if (agentStates && Object.values(agentStates).some(hasRunningAgentState)) return true;
  return hasRunningAgentState(record.action);
};

const hasRunningCollaboration = (items: readonly CodexCanonicalItem[]): boolean =>
  items.some(
    (item) =>
      item.type === "collabAgentToolCall" &&
      (item.status === "inProgress" || hasRunningAgentState(item.agentsStates)),
  );

const hasPendingSteering = (items: readonly CodexCanonicalItem[]): boolean =>
  items.some((item) => item.type === "steeringUserMessage" && item.status === "pending");

const canonicalActivity = (
  state: CodexCanonicalConversationState | null,
): { readonly active: boolean; readonly pending: boolean; readonly label: string | null } => {
  if (!state) return { active: false, pending: false, label: null };
  const items = state.turns.flatMap((turn) => turn.items);
  const status = state.protocol.status;
  return {
    active:
      status.type === "active" ||
      state.turns.some((turn) => turn.protocol.status === "inProgress") ||
      hasRunningCollaboration(items) ||
      state.sidecar.threadGoal?.status === "active",
    pending:
      (status.type === "active" && status.activeFlags.length > 0) ||
      state.requests.length > 0 ||
      hasPendingSteering(items),
    label: state.protocol.name?.trim() || null,
  };
};

const snapshotActivity = (
  snapshot: CodexConversationSnapshot | null,
): { readonly active: boolean; readonly pending: boolean; readonly label: string | null } => {
  if (!snapshot) return { active: false, pending: false, label: null };
  return {
    active:
      snapshot.statusType === "active" ||
      snapshot.turns.some((turn) => turn.status === "inProgress") ||
      snapshot.threadGoal?.status === "active",
    pending:
      snapshot.statusActiveFlags.length > 0 ||
      snapshot.requests.length > 0 ||
      snapshot.pendingSteers.length > 0,
    label: snapshot.threadName?.trim() || null,
  };
};

const deduplicate = (blockers: readonly ProjectArchiveBlocker[]): ProjectArchiveBlocker[] => {
  const seen = new Set<string>();
  return blockers.filter((blocker) => {
    const key =
      blocker.kind === "terminal"
        ? `${blocker.kind}:${blocker.terminalSessionId}`
        : blocker.kind === "background-process"
          ? `${blocker.kind}:${blocker.threadId}:${blocker.processId ?? blocker.label ?? "unknown"}`
          : `${blocker.kind}:${blocker.threadId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

export const live: Layer.Layer<
  ProjectArchiveBlockers,
  never,
  CodexBackgroundProcesses | ConversationRuntimeMap | TerminalSessions
> = Layer.effect(
  ProjectArchiveBlockers,
  Effect.gen(function* () {
    const backgroundProcesses = yield* CodexBackgroundProcesses;
    const conversations = yield* ConversationRuntimeMap;
    const terminals = yield* TerminalSessions;

    const list = Effect.fn("ProjectArchiveBlockers.list")(function* (
      ownership: ProjectArchiveOwnership,
    ) {
      const sessionIds = new Set(ownership.sessions.map((session) => session.id));
      const threadSummaries = ownership.sessions.flatMap((session) =>
        session.thread ? [session.thread] : [],
      );
      const threadIds = [...new Set(threadSummaries.map((thread) => thread.threadId))];
      const durableThreadById = new Map(
        threadSummaries.map((thread) => [thread.threadId, thread] as const),
      );
      const codexBlockers = threadIds.flatMap<ProjectArchiveBlocker>((threadId) => {
        const aggregate = conversations.currentConversation(threadId);
        const current = aggregate?.read() ?? null;
        const canonical = canonicalActivity(current?.canonicalState ?? null);
        const projected = snapshotActivity(current?.snapshot ?? null);
        const durable = durableThreadById.get(threadId);
        const label = canonical.label || projected.label || durable?.threadName?.trim() || null;
        const active = canonical.active || projected.active || durable?.statusType === "active";
        const pending =
          canonical.pending || projected.pending || (durable?.statusActiveFlags.length ?? 0) > 0;
        return [
          ...(active ? [{ kind: "active-turn", threadId, label } as const] : []),
          ...(pending ? [{ kind: "pending-request", threadId, label } as const] : []),
        ];
      });
      const terminalSnapshots = yield* terminals.listLiveSessionsForOwners({
        conversationIds: new Set(threadIds),
        projectSessionIds: sessionIds,
      });
      const terminalBlockers = terminalSnapshots.map<ProjectArchiveBlocker>((session) => ({
        kind: "terminal",
        terminalSessionId: session.sessionId,
        projectSessionId: session.projectSessionId,
      }));
      const processRows = yield* Effect.all(
        threadIds.map((threadId) => backgroundProcesses.list({ threadId })),
        { concurrency: "unbounded" },
      );
      const processBlockers = processRows.flatMap((rows) =>
        rows.flatMap<ProjectArchiveBlocker>((row) =>
          row.status === "running"
            ? [
                {
                  kind: "background-process",
                  threadId: row.threadId,
                  processId: row.processId,
                  label: row.command.trim() || row.threadTitle?.trim() || null,
                },
              ]
            : [],
        ),
      );
      return deduplicate([...codexBlockers, ...terminalBlockers, ...processBlockers]);
    });

    return ProjectArchiveBlockers.of({ list });
  }),
);
