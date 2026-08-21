import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export interface ProjectSessionBrowserRuntime<Error, Requirements> {
  closeBrowserConversation: (
    browserConversationId: string,
  ) => Effect.Effect<void, Error, Requirements>;
}

export interface DeleteProjectSessionWithBrowserCleanupInput<
  DeleteError,
  BrowserError,
  Requirements,
> {
  readonly sessionId: string;
  readonly browserRuntime: ProjectSessionBrowserRuntime<BrowserError, Requirements>;
  readonly deleteProjectSession: (
    sessionId: string,
  ) => Effect.Effect<boolean, DeleteError, Requirements>;
}

export class ProjectSessionBrowserCleanupError extends Schema.TaggedError<ProjectSessionBrowserCleanupError>()(
  "ProjectSessionBrowserCleanupError",
  { operation: Schema.Literals(["delete", "close-browser"]), cause: Schema.Defect() },
) {}

const attempt = <A, Error, Requirements>(
  operation: ProjectSessionBrowserCleanupError["operation"],
  effect: Effect.Effect<A, Error, Requirements>,
): Effect.Effect<A, ProjectSessionBrowserCleanupError, Requirements> =>
  effect.pipe(
    Effect.mapError((cause) => new ProjectSessionBrowserCleanupError({ operation, cause })),
  );

export const deleteProjectSessionWithBrowserCleanupUsing = <
  DeleteError,
  BrowserError,
  Requirements,
>(
  input: DeleteProjectSessionWithBrowserCleanupInput<DeleteError, BrowserError, Requirements>,
): Effect.Effect<boolean, ProjectSessionBrowserCleanupError, Requirements> =>
  Effect.gen(function* () {
    const deleted = yield* attempt("delete", input.deleteProjectSession(input.sessionId));
    if (!deleted) return false;

    yield* attempt("close-browser", input.browserRuntime.closeBrowserConversation(input.sessionId));
    return true;
  });
