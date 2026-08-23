import { randomUUID } from "node:crypto";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import type { FrozenNodexAgentTurnAuthority } from "../../shared/nodex-agent-authority";
import { FULL_ACCESS_PERMISSION_PROFILE_ID } from "../codex/codex-permission-resolver";
import { CoreModuleResponseError } from "../core-client/core-client";
import { CoreAuthority } from "../core-runtime/CoreAuthority";
import { CoreModules } from "../core-runtime/CoreModules";
import { CodexConversationContext } from "./CodexConversationContext";

export class CodexTurnAuthorityError extends Schema.TaggedError<CodexTurnAuthorityError>()(
  "CodexTurnAuthorityError",
  {
    operation: Schema.Literals(["begin", "bind"]),
    threadId: Schema.String,
    cause: Schema.Defect(),
  },
) {}

export interface CodexTurnAuthorityLaunch {
  readonly launchId: string;
  readonly snapshot: {
    readonly threadId: string;
    readonly rootThreadId: string;
    readonly actorProjectId: string;
    readonly libraryId: string;
    readonly profileId: string;
    readonly storeEpoch: string;
    readonly scope: FrozenNodexAgentTurnAuthority["scope"];
    readonly source: FrozenNodexAgentTurnAuthority["source"];
    readonly permissionProfileId: string | null;
  };
  boundTurnId: string | null;
  aborted: boolean;
}

export class CodexTurnAuthority extends Context.Service<
  CodexTurnAuthority,
  {
    readonly begin: (
      threadId: string,
      builtinFullAccess: boolean,
    ) => Effect.Effect<CodexTurnAuthorityLaunch | null, CodexTurnAuthorityError>;
    readonly bind: (
      threadId: string,
      launch: CodexTurnAuthorityLaunch | null,
      turnId: string,
    ) => Effect.Effect<void, CodexTurnAuthorityError>;
    readonly abort: (launch: CodexTurnAuthorityLaunch | null) => void;
  }
>()("nodex/main/codex-application/CodexTurnAuthority") {}

const normalizeIdentity = (value: string): string | null => {
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= 512 ? normalized : null;
};

/** Owns pending authority launches and freezes the exact accepted Turn directly in Core. */
export const make: Effect.Effect<
  CodexTurnAuthority["Service"],
  never,
  CodexConversationContext | CoreAuthority | CoreModules | Scope.Scope
> = Effect.gen(function* () {
  const conversationContext = yield* CodexConversationContext;
  const coreAuthority = yield* CoreAuthority;
  const core = yield* CoreModules;
  const pendingByThreadId = new Map<string, CodexTurnAuthorityLaunch[]>();

  const removePending = (launch: CodexTurnAuthorityLaunch): void => {
    const pending = pendingByThreadId.get(launch.snapshot.threadId);
    if (!pending) return;
    const next = pending.filter((candidate) => candidate !== launch);
    if (next.length === 0) pendingByThreadId.delete(launch.snapshot.threadId);
    else pendingByThreadId.set(launch.snapshot.threadId, next);
  };

  const abort = (launch: CodexTurnAuthorityLaunch | null): void => {
    if (!launch || launch.boundTurnId) return;
    launch.aborted = true;
    removePending(launch);
  };

  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      for (const launches of pendingByThreadId.values()) {
        for (const launch of launches) abort(launch);
      }
      pendingByThreadId.clear();
    }),
  );

  const begin: CodexTurnAuthority["Service"]["begin"] = (threadId, builtinFullAccess) =>
    Effect.gen(function* () {
      const lineage = yield* conversationContext.read(threadId);
      const actorProjectId = normalizeIdentity(lineage.projectId ?? "");
      const normalizedThreadId = normalizeIdentity(threadId);
      const rootThreadId = normalizeIdentity(lineage.rootThreadId);
      if (!actorProjectId || !normalizedThreadId || !rootThreadId) return null;

      const projectSnapshot = yield* core.workspace
        .read({ kind: "project", project_id: actorProjectId }, undefined, actorProjectId)
        .pipe(
          Effect.map((snapshot) => snapshot as typeof snapshot | null),
          Effect.catch((error) =>
            error.cause instanceof CoreModuleResponseError &&
            error.cause.coreError.code === "not_found"
              ? Effect.succeed(null)
              : Effect.fail(error),
          ),
        );
      if (projectSnapshot === null) return null;
      if (projectSnapshot.value.kind !== "project") {
        return yield* new CodexTurnAuthorityError({
          operation: "begin",
          threadId,
          cause: new Error("Core returned the wrong Project authority variant"),
        });
      }
      if (projectSnapshot.value.project.library_id !== coreAuthority.identity.libraryId)
        return null;

      const scope = builtinFullAccess ? "library" : "project";
      const launch: CodexTurnAuthorityLaunch = {
        launchId: randomUUID(),
        snapshot: {
          threadId: normalizedThreadId,
          rootThreadId,
          actorProjectId,
          libraryId: projectSnapshot.value.project.library_id,
          profileId: coreAuthority.identity.profileId,
          storeEpoch: coreAuthority.identity.storeEpoch,
          scope,
          source: builtinFullAccess ? "builtin_full_access" : "project_turn",
          permissionProfileId: scope === "library" ? FULL_ACCESS_PERMISSION_PROFILE_ID : null,
        },
        boundTurnId: null,
        aborted: false,
      };
      const pending = pendingByThreadId.get(normalizedThreadId) ?? [];
      pending.push(launch);
      pendingByThreadId.set(normalizedThreadId, pending);
      return launch;
    }).pipe(
      Effect.mapError((cause) =>
        cause instanceof CodexTurnAuthorityError
          ? cause
          : new CodexTurnAuthorityError({ operation: "begin", threadId, cause }),
      ),
    );

  const bind: CodexTurnAuthority["Service"]["bind"] = (threadId, launch, rawTurnId) => {
    if (!launch || launch.aborted) return Effect.void;
    const turnId = normalizeIdentity(rawTurnId);
    if (!turnId) return Effect.void;
    return Effect.gen(function* () {
      if (launch.boundTurnId && launch.boundTurnId !== turnId) {
        return yield* new CodexTurnAuthorityError({
          operation: "bind",
          threadId,
          cause: new Error(
            `Nodex Agent authority launch ${launch.launchId} is already bound to Turn ${launch.boundTurnId}`,
          ),
        });
      }
      if (!launch.boundTurnId) {
        yield* core.workspace.apply(
          {
            operationId: `electron:turn-authority:${launch.launchId}:${turnId}`,
            intent: {
              kind: "freeze_turn_authority",
              thread_id: launch.snapshot.threadId,
              turn_id: turnId,
              root_thread_id: launch.snapshot.rootThreadId,
              actor_project_id: launch.snapshot.actorProjectId,
              source: launch.snapshot.source,
            },
          },
          undefined,
          launch.snapshot.actorProjectId,
        );
        // The Core apply receipt is the authority commit point. Verification may fail, but a
        // committed launch must never remain abortable or leak in the pending launch set.
        launch.boundTurnId = turnId;
        removePending(launch);
      }
      const snapshot = yield* core.workspace.read(
        {
          kind: "turn_authority",
          thread_id: launch.snapshot.threadId,
          turn_id: turnId,
          root_thread_id: launch.snapshot.rootThreadId,
          actor_project_id: launch.snapshot.actorProjectId,
        },
        undefined,
        launch.snapshot.actorProjectId,
      );
      if (
        snapshot.value.kind !== "turn_authority" ||
        !snapshot.value.resolution.persisted ||
        snapshot.value.resolution.authority?.turn_id !== turnId
      ) {
        return yield* new CodexTurnAuthorityError({
          operation: "bind",
          threadId,
          cause: new Error("Core did not persist the exact Turn authority"),
        });
      }
    }).pipe(
      Effect.mapError((cause) =>
        cause instanceof CodexTurnAuthorityError
          ? cause
          : new CodexTurnAuthorityError({ operation: "bind", threadId, cause }),
      ),
    );
  };

  return CodexTurnAuthority.of({ begin, bind, abort });
});
