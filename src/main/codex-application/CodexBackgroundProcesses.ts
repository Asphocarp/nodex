import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Scope from "effect/Scope";
import type { ThreadBackgroundTerminal } from "@nodex/codex-app-server-protocol/v2/ThreadBackgroundTerminal";
import type { ClientRequestResponsesByMethod } from "@nodex/effect-codex-app-server/rpc";
import type {
  CodexBackgroundProcessRecord,
  CodexBackgroundProcessRow,
  CodexBackgroundProcessRunActionInput,
  TerminalRunActionRequest,
} from "../../shared/types";
import { makeCodexBackgroundProcessRecordId } from "../../shared/codex-background-processes";
import { buildCodexBackgroundProcessRow } from "../codex/background-process-rows";
import type { DesktopProjectWorkspacePort } from "../core-client/project-workspace-adapter";
import { ProjectRuntimeLifecycleRuntime } from "../host-runtime/ProjectRuntimeLifecycleRuntime";
import { CodexGateway } from "../codex-runtime/CodexGateway";
import { TerminalSessions, type TerminalOwner } from "../terminal-runtime/TerminalSessions";

type ProjectWorkspace = Pick<
  DesktopProjectWorkspacePort,
  "getProject" | "getThread" | "listBackgroundProcesses" | "upsertBackgroundProcess"
>;

export interface CodexBackgroundProcessConversationProjection {
  readonly threadTitle: string | null;
  readonly terminalItems: readonly {
    readonly itemId: string;
    readonly processId: string | null;
    readonly turnId: string | null;
    readonly createdAt: number;
  }[];
}

export interface CodexBackgroundProcessesOptions {
  readonly projectWorkspace: ProjectWorkspace;
  readonly conversationProjection: (
    threadId: string,
  ) => CodexBackgroundProcessConversationProjection;
}

export class CodexBackgroundProcessesError extends Data.TaggedError(
  "CodexBackgroundProcessesError",
)<{
  readonly operation: "list" | "run-action";
  readonly cause: unknown;
}> {}

export class CodexBackgroundProcesses extends Context.Service<
  CodexBackgroundProcesses,
  {
    readonly list: (input: {
      readonly threadId: string;
      readonly observedTerminals?: readonly ThreadBackgroundTerminal[];
    }) => Effect.Effect<CodexBackgroundProcessRow[], CodexBackgroundProcessesError>;
    readonly runAction: (input: {
      readonly action: CodexBackgroundProcessRunActionInput;
      readonly owner: TerminalOwner;
    }) => Effect.Effect<CodexBackgroundProcessRow[], CodexBackgroundProcessesError>;
  }
>()("nodex/main/codex-application/CodexBackgroundProcesses") {}

interface NormalizedRunAction {
  readonly threadId: string;
  readonly threadTitle: string | null;
  readonly itemId: string;
  readonly turnId: string | null;
  readonly command: string;
  readonly cwd: string;
  readonly terminalSessionId: string;
}

const normalizeRunAction = (input: CodexBackgroundProcessRunActionInput): NormalizedRunAction => {
  const action = {
    threadId: input.threadId.trim(),
    threadTitle: input.threadTitle?.trim() || null,
    itemId: input.itemId.trim(),
    turnId: input.turnId?.trim() || null,
    command: input.command.trim(),
    cwd: input.cwd.trim(),
    terminalSessionId: input.terminalSessionId.trim(),
  };
  if (
    !action.threadId ||
    !action.itemId ||
    !action.command ||
    !action.cwd ||
    !action.terminalSessionId
  ) {
    throw new Error("Background process action requires thread, item, command, cwd, and terminal");
  }
  return action;
};

const terminalRequest = (action: NormalizedRunAction): TerminalRunActionRequest => ({
  sessionId: action.terminalSessionId,
  conversationId: action.threadId,
  cwd: action.cwd,
  command: action.command,
  title: action.command,
});

type GatewayTerminal =
  ClientRequestResponsesByMethod["thread/backgroundTerminals/list"]["data"][number];

const projectGatewayTerminal = (terminal: GatewayTerminal): ThreadBackgroundTerminal => ({
  itemId: terminal.itemId,
  processId: terminal.processId,
  command: terminal.command,
  cwd: terminal.cwd,
  osPid: terminal.osPid ?? null,
  cpuPercent: terminal.cpuPercent ?? null,
  rssKb: terminal.rssKb == null ? null : BigInt(Math.trunc(terminal.rssKb)),
});

export const make = (
  options: CodexBackgroundProcessesOptions,
): Effect.Effect<
  CodexBackgroundProcesses["Service"],
  never,
  CodexGateway | ProjectRuntimeLifecycleRuntime | Scope.Scope | TerminalSessions
> =>
  Effect.gen(function* () {
    const gateway = yield* CodexGateway;
    const projectLifecycle = yield* ProjectRuntimeLifecycleRuntime;
    const terminals = yield* TerminalSessions;
    const ownerScope = yield* Scope.Scope;

    const fail = (
      operation: CodexBackgroundProcessesError["operation"],
      cause: unknown,
    ): CodexBackgroundProcessesError => new CodexBackgroundProcessesError({ operation, cause });
    const runOwned = <A, E>(operation: Effect.Effect<A, E>): Effect.Effect<A, E> =>
      Effect.acquireUseRelease(
        operation.pipe(Effect.forkIn(ownerScope, { startImmediately: true })),
        Fiber.join,
        Fiber.interrupt,
      );
    const project = <A>(
      operation: CodexBackgroundProcessesError["operation"],
      run: () => Promise<A>,
    ): Effect.Effect<A, CodexBackgroundProcessesError> =>
      Effect.tryPromise({ try: run, catch: (cause) => fail(operation, cause) });

    const listLiveTerminals = (
      threadId: string,
      cursor: string | null = null,
      collected: readonly ThreadBackgroundTerminal[] = [],
    ): Effect.Effect<readonly ThreadBackgroundTerminal[]> =>
      gateway
        .requestForThread(threadId, "thread/backgroundTerminals/list", {
          threadId,
          cursor,
          limit: 100,
        })
        .pipe(
          Effect.flatMap((response) => {
            const next = [...collected, ...response.data.map(projectGatewayTerminal)];
            return response.nextCursor
              ? listLiveTerminals(threadId, response.nextCursor, next)
              : Effect.succeed(next);
          }),
          Effect.catch((cause) =>
            Effect.logWarning(
              "Falling back to registered background processes without live terminal snapshots",
            ).pipe(
              Effect.annotateLogs({ threadId, errorTag: cause._tag }),
              Effect.as<readonly ThreadBackgroundTerminal[]>([]),
            ),
          ),
        );

    const observe = (
      operation: CodexBackgroundProcessesError["operation"],
      threadId: string,
      observed: readonly ThreadBackgroundTerminal[],
    ): Effect.Effect<void, CodexBackgroundProcessesError> => {
      if (observed.length === 0) return Effect.void;
      const projection = options.conversationProjection(threadId);
      const itemByTerminalKey = new Map<
        string,
        CodexBackgroundProcessConversationProjection["terminalItems"][number]
      >();
      for (const item of projection.terminalItems) {
        itemByTerminalKey.set(item.itemId, item);
        if (item.processId) itemByTerminalKey.set(item.processId, item);
      }

      return Clock.currentTimeMillis.pipe(
        Effect.flatMap((now) =>
          Effect.forEach(
            observed,
            (terminal) => {
              const command = terminal.command.trim();
              if (!command) return Effect.void;
              const item =
                itemByTerminalKey.get(terminal.itemId) ??
                itemByTerminalKey.get(String(terminal.processId));
              return project(operation, () =>
                options.projectWorkspace.upsertBackgroundProcess({
                  id: makeCodexBackgroundProcessRecordId({
                    threadId,
                    itemId: terminal.itemId,
                  }),
                  threadId,
                  threadTitle: projection.threadTitle,
                  itemId: terminal.itemId,
                  turnId: item?.turnId ?? null,
                  command,
                  cwd: terminal.cwd,
                  processId: terminal.processId.trim() || null,
                  osPid: terminal.osPid,
                  terminalSessionId: null,
                  source: "app-server",
                  startedAtMs: item?.createdAt ?? now,
                  updatedAtMs: now,
                }),
              ).pipe(Effect.asVoid);
            },
            { discard: true },
          ),
        ),
      );
    };

    const buildRows = (
      operation: CodexBackgroundProcessesError["operation"],
      threadId: string,
      observed: readonly ThreadBackgroundTerminal[],
    ): Effect.Effect<CodexBackgroundProcessRow[], CodexBackgroundProcessesError> =>
      Effect.gen(function* () {
        const records = yield* project(operation, () =>
          options.projectWorkspace.listBackgroundProcesses(threadId),
        );
        const terminalSessionIds = records
          .map((record) => record.terminalSessionId)
          .filter((sessionId): sessionId is string => sessionId !== null);
        yield* terminals.refreshSessionProcessMetrics(terminalSessionIds);

        const observedByRecordId = new Map<string, ThreadBackgroundTerminal>();
        for (const terminal of observed) {
          observedByRecordId.set(
            makeCodexBackgroundProcessRecordId({ threadId, itemId: terminal.itemId }),
            terminal,
          );
        }
        return yield* Effect.forEach(
          records,
          (record) =>
            (record.terminalSessionId
              ? terminals.getSessionSnapshot(record.terminalSessionId)
              : Effect.succeed(null)
            ).pipe(
              Effect.map((terminalSession) =>
                buildCodexBackgroundProcessRow({
                  record,
                  terminal: observedByRecordId.get(record.id) ?? null,
                  terminalSession,
                }),
              ),
            ),
          { concurrency: "unbounded" },
        );
      });

    const list = (input: {
      readonly threadId: string;
      readonly observedTerminals?: readonly ThreadBackgroundTerminal[];
    }): Effect.Effect<CodexBackgroundProcessRow[], CodexBackgroundProcessesError> => {
      const threadId = input.threadId.trim();
      if (!threadId) return Effect.succeed([]);
      return runOwned(
        Effect.gen(function* () {
          const observed = input.observedTerminals ?? (yield* listLiveTerminals(threadId));
          yield* observe("list", threadId, observed);
          return yield* buildRows("list", threadId, observed);
        }),
      );
    };

    const readActiveProjectId = (
      operation: CodexBackgroundProcessesError["operation"],
      threadId: string,
    ): Effect.Effect<string | null, CodexBackgroundProcessesError> =>
      Effect.gen(function* () {
        const thread = yield* project(operation, () =>
          options.projectWorkspace.getThread(threadId),
        );
        if (!thread) {
          return yield* Effect.fail(fail(operation, new Error("Unknown Codex Thread")));
        }
        const projectId = thread.projectId ?? null;
        if (!projectId) return null;
        const owningProject = yield* project(operation, () =>
          options.projectWorkspace.getProject(projectId),
        );
        if (owningProject?.lifecycle === "active") return projectId;
        return yield* Effect.fail(
          fail(operation, new Error("Terminals require an active Project owner")),
        );
      });

    const register = (
      action: NormalizedRunAction,
    ): Effect.Effect<CodexBackgroundProcessRecord, CodexBackgroundProcessesError> =>
      Clock.currentTimeMillis.pipe(
        Effect.flatMap((now) => {
          const projection = options.conversationProjection(action.threadId);
          return project("run-action", () =>
            options.projectWorkspace.upsertBackgroundProcess(
              {
                id: makeCodexBackgroundProcessRecordId({
                  threadId: action.threadId,
                  itemId: action.itemId,
                }),
                threadId: action.threadId,
                threadTitle: action.threadTitle ?? projection.threadTitle,
                itemId: action.itemId,
                turnId: action.turnId,
                command: action.command,
                cwd: action.cwd,
                processId: null,
                osPid: null,
                terminalSessionId: action.terminalSessionId,
                source: "terminal-action",
                startedAtMs: now,
                updatedAtMs: now,
              },
              { preserveStartedAt: false },
            ),
          );
        }),
      );

    return CodexBackgroundProcesses.of({
      list,
      runAction: ({ action: rawAction, owner }) =>
        Effect.try({
          try: () => normalizeRunAction(rawAction),
          catch: (cause) => fail("run-action", cause),
        }).pipe(
          Effect.flatMap((action) =>
            runOwned(
              Effect.gen(function* () {
                const initialProjectId = yield* readActiveProjectId("run-action", action.threadId);
                yield* projectLifecycle.runExclusive(
                  initialProjectId,
                  Effect.gen(function* () {
                    const admittedProjectId = yield* readActiveProjectId(
                      "run-action",
                      action.threadId,
                    );
                    if (admittedProjectId !== initialProjectId) {
                      return yield* Effect.fail(
                        fail(
                          "run-action",
                          new Error("Thread Project owner changed during admission"),
                        ),
                      );
                    }
                    yield* register(action);
                    yield* terminals
                      .runAction(owner, terminalRequest(action))
                      .pipe(Effect.mapError((cause) => fail("run-action", cause)));
                  }),
                );
                return yield* buildRows("run-action", action.threadId, []);
              }),
            ),
          ),
        ),
    });
  });
