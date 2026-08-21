import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { normalizeCodexManualThreadTitle } from "../shared/codex-thread-title";
import { ProjectSessionRenameInputSchema } from "../shared/schemas/project-sessions";
import type { ProjectSession, ProjectSessionRenameInput } from "../shared/types";

export interface ProjectSessionRenameServiceDeps<
  ReadError,
  RenameError,
  ThreadError,
  Requirements,
> {
  getProjectSession: (
    sessionId: string,
  ) => Effect.Effect<ProjectSession | null, ReadError, Requirements>;
  renameProjectSession: (
    sessionId: string,
    input: ProjectSessionRenameInput,
  ) => Effect.Effect<ProjectSession | null, RenameError, Requirements>;
  setThreadName: (
    threadId: string,
    rawTitle: string,
  ) => Effect.Effect<boolean, ThreadError, Requirements>;
}

export class ProjectSessionRenameError extends Schema.TaggedError<ProjectSessionRenameError>()(
  "ProjectSessionRenameError",
  {
    operation: Schema.Literals(["parse", "read", "rename-session", "rename-thread"]),
    cause: Schema.Defect(),
  },
) {}

const attempt = <A, Error, Requirements>(
  operation: ProjectSessionRenameError["operation"],
  effect: Effect.Effect<A, Error, Requirements>,
): Effect.Effect<A, ProjectSessionRenameError, Requirements> =>
  effect.pipe(Effect.mapError((cause) => new ProjectSessionRenameError({ operation, cause })));

export const renameProjectSessionChat = <ReadError, RenameError, ThreadError, Requirements>(
  sessionId: string,
  input: ProjectSessionRenameInput,
  deps: ProjectSessionRenameServiceDeps<ReadError, RenameError, ThreadError, Requirements>,
): Effect.Effect<ProjectSession | null, ProjectSessionRenameError, Requirements> =>
  Effect.gen(function* () {
    const parsed = yield* Effect.try({
      try: () => ProjectSessionRenameInputSchema.parse(input),
      catch: (cause) => new ProjectSessionRenameError({ operation: "parse", cause }),
    });
    const existing = yield* attempt("read", deps.getProjectSession(sessionId));
    if (!existing) return null;

    const normalizedTitle = normalizeCodexManualThreadTitle(parsed.title);
    if (!normalizedTitle) {
      return existing;
    }

    if (existing.thread) {
      const renamedThread = yield* attempt(
        "rename-thread",
        deps.setThreadName(existing.thread.threadId, parsed.title),
      );
      if (!renamedThread) return existing;
      return (
        (yield* attempt(
          "rename-session",
          deps.renameProjectSession(sessionId, { title: normalizedTitle }),
        )) ?? existing
      );
    }

    return yield* attempt(
      "rename-session",
      deps.renameProjectSession(sessionId, { title: normalizedTitle }),
    );
  });
