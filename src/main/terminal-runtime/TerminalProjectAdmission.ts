import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import type {
  TerminalAttachRequest,
  TerminalCreateRequest,
  TerminalRunActionRequest,
} from "../../shared/types";
import { CoreModules } from "../core-runtime/CoreModules";
import { ProjectRuntimeLifecycleRuntime } from "../host-runtime/ProjectRuntimeLifecycleRuntime";

export type TerminalProjectOwnershipInput =
  | TerminalCreateRequest
  | TerminalAttachRequest
  | TerminalRunActionRequest;

export class TerminalProjectAdmissionError extends Schema.TaggedError<TerminalProjectAdmissionError>()(
  "TerminalProjectAdmissionError",
  {
    operation: Schema.String,
    cause: Schema.Defect(),
  },
) {}

export class TerminalProjectAdmission extends Context.Service<
  TerminalProjectAdmission,
  {
    readonly run: <A, E, R>(
      input: TerminalProjectOwnershipInput,
      operation: Effect.Effect<A, E, R>,
    ) => Effect.Effect<A, E | TerminalProjectAdmissionError, R>;
  }
>()("nodex/main/terminal-runtime/TerminalProjectAdmission") {}

const admissionError = (operation: string, cause: unknown) =>
  new TerminalProjectAdmissionError({ operation, cause });

type ResolveProjectId = (
  input: TerminalProjectOwnershipInput,
) => Effect.Effect<string | null, TerminalProjectAdmissionError>;

export const fromResolver = (
  resolveProjectId: ResolveProjectId,
): Layer.Layer<TerminalProjectAdmission, never, ProjectRuntimeLifecycleRuntime> =>
  Layer.effect(
    TerminalProjectAdmission,
    Effect.gen(function* () {
      const projectLifecycle = yield* ProjectRuntimeLifecycleRuntime;
      const assertActive = (input: TerminalProjectOwnershipInput) => resolveProjectId(input);
      return TerminalProjectAdmission.of({
        run: (input, operation) =>
          assertActive(input).pipe(
            Effect.andThen((projectId) =>
              projectLifecycle.runExclusive(
                projectId,
                assertActive(input).pipe(Effect.andThen(operation)),
              ),
            ),
          ),
      });
    }),
  );

export const live: Layer.Layer<
  TerminalProjectAdmission,
  never,
  CoreModules | ProjectRuntimeLifecycleRuntime
> = Layer.unwrap(
  Effect.gen(function* () {
    const core = yield* CoreModules;
    const resolveProjectId = Effect.fn("TerminalProjectAdmission.resolveProjectId")(function* (
      input: TerminalProjectOwnershipInput,
    ) {
      const session = input.projectSessionId
        ? yield* core.workspace
            .read({ kind: "session", session_id: input.projectSessionId })
            .pipe(Effect.mapError((cause) => admissionError("read-session", cause)))
        : null;
      const thread = input.conversationId
        ? yield* core.workspace
            .read({ kind: "thread", thread_id: input.conversationId })
            .pipe(Effect.mapError((cause) => admissionError("read-thread", cause)))
        : null;
      const sessionProjectId =
        session?.value.kind === "session" ? (session.value.session.project_id ?? null) : null;
      const threadProjectId =
        thread?.value.kind === "thread" ? (thread.value.thread.project_id ?? null) : null;
      if (
        sessionProjectId !== null &&
        threadProjectId !== null &&
        sessionProjectId !== threadProjectId
      ) {
        return yield* admissionError(
          "owner-mismatch",
          new Error("Terminal Session and Thread must have the same Project owner"),
        );
      }
      const projectId = sessionProjectId ?? threadProjectId;
      if (projectId === null) return null;
      const snapshot = yield* core.workspace
        .read({ kind: "project", project_id: projectId }, undefined, projectId)
        .pipe(Effect.mapError((cause) => admissionError("read-project", cause)));
      if (snapshot.value.kind === "project" && snapshot.value.project.lifecycle === "active") {
        return projectId;
      }
      return yield* admissionError(
        "inactive-project",
        new Error("Terminals cannot be started for an inactive or removed project"),
      );
    });
    return fromResolver(resolveProjectId);
  }),
);
