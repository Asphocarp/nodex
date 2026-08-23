import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type { PersistedAtomStore } from "../local-store/persisted-atoms";
import { ProjectWorkspace } from "../project-application/ProjectWorkspace";
import {
  codexClientThreadIdentityAtomKey,
  getCodexClientThreadId,
  resolveCodexThreadIdForClientThreadId,
  setCodexClientThreadIdentity,
} from "../codex/codex-client-thread-identity";
import { CODEX_APP_LOCAL_HOST_ID } from "../codex/codex-app-meta-thread-tools";

export class CodexClientThreadIdentityError extends Schema.TaggedError<CodexClientThreadIdentityError>()(
  "CodexClientThreadIdentityError",
  {
    operation: Schema.String,
    cause: Schema.Defect(),
  },
) {}

export class CodexClientThreadIdentity extends Context.Service<
  CodexClientThreadIdentity,
  {
    readonly remember: (
      threadId: string,
      clientThreadId: string,
    ) => Effect.Effect<void, CodexClientThreadIdentityError>;
    readonly forget: (threadId: string) => Effect.Effect<void, CodexClientThreadIdentityError>;
    readonly threadIdFor: (
      clientThreadId: string,
    ) => Effect.Effect<string | null, CodexClientThreadIdentityError>;
    readonly clientThreadIdFor: (
      threadId: string,
    ) => Effect.Effect<string | null, CodexClientThreadIdentityError>;
    /** Resolves the browser-facing Session identity used while a pending Thread is materializing. */
    readonly resolveBrowserConversationId: (
      conversationId: string,
    ) => Effect.Effect<string, CodexClientThreadIdentityError>;
  }
>()("nodex/main/codex-application/CodexClientThreadIdentity") {}

export const make = (
  store: PersistedAtomStore,
): Effect.Effect<CodexClientThreadIdentity["Service"], never, ProjectWorkspace> =>
  Effect.gen(function* () {
    const workspace = yield* ProjectWorkspace;
    const attempt = <A>(operation: string, evaluate: () => A) =>
      Effect.try({
        try: evaluate,
        catch: (cause) => new CodexClientThreadIdentityError({ operation, cause }),
      });
    const remember = (threadId: string, clientThreadId: string) =>
      attempt("remember", () => {
        const existingThreadId = resolveCodexThreadIdForClientThreadId(
          store,
          CODEX_APP_LOCAL_HOST_ID,
          clientThreadId,
        );
        if (existingThreadId && existingThreadId !== threadId) {
          throw new Error(
            `Client Thread identity is already bound to Thread '${existingThreadId}'`,
          );
        }
        if (
          !setCodexClientThreadIdentity(store, {
            hostId: CODEX_APP_LOCAL_HOST_ID,
            threadId,
            clientThreadId,
          })
        ) {
          throw new Error(`Invalid client Thread identity for '${threadId}'`);
        }
      });
    const threadIdFor = (clientThreadId: string) =>
      attempt("resolve-thread", () =>
        resolveCodexThreadIdForClientThreadId(store, CODEX_APP_LOCAL_HOST_ID, clientThreadId),
      );
    const clientThreadIdFor = (threadId: string) =>
      attempt("resolve-client", () =>
        getCodexClientThreadId(store, CODEX_APP_LOCAL_HOST_ID, threadId),
      );

    return CodexClientThreadIdentity.of({
      remember,
      forget: (threadId) =>
        attempt("forget", () => {
          store.update({
            key: codexClientThreadIdentityAtomKey(CODEX_APP_LOCAL_HOST_ID, threadId),
            value: null,
          });
        }),
      threadIdFor,
      clientThreadIdFor,
      resolveBrowserConversationId: (conversationId) =>
        Effect.gen(function* () {
          const directSession = yield* workspace.getProjectSession(conversationId).pipe(
            Effect.mapError(
              (cause) =>
                new CodexClientThreadIdentityError({
                  operation: "resolve-browser-session",
                  cause,
                }),
            ),
          );
          if (directSession) return directSession.id;
          const resolvedThreadId = (yield* threadIdFor(conversationId)) ?? conversationId;
          const thread = yield* workspace.getThread(resolvedThreadId).pipe(
            Effect.mapError(
              (cause) =>
                new CodexClientThreadIdentityError({
                  operation: "resolve-browser-thread",
                  cause,
                }),
            ),
          );
          if (thread?.sessionId) return thread.sessionId;
          return (yield* clientThreadIdFor(conversationId)) ?? conversationId;
        }),
    });
  });
