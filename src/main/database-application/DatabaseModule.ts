import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import type { ContentAccessContext } from "../../shared/content-access-context";
import type {
  DatabaseApplyResultV2,
  DatabaseApplyV2,
  DatabaseModuleReadRequestV2,
  DatabaseModuleReadResultV2,
  LibraryDatabaseApplyResultV2,
  LibraryDatabaseApplyV2,
  LibraryDatabaseModuleReadRequestV2,
  LibraryDatabaseModuleReadResultV2,
  LibraryDatabaseReadV2,
} from "../../shared/database-module-v2";
import type {
  DatabaseListWindowInput,
  DatabaseListWindowSnapshot,
  DatabaseViewGroupsInput,
  DatabaseViewGroupsSnapshot,
  DatabaseViewReadModel,
  DatabaseViewWindowInput,
  DatabaseViewWindowSnapshot,
  ReadDatabaseViewReferenceInput,
} from "../../shared/database-views";
import { parseDatabaseViewId } from "../../shared/database-identities";
import {
  createCoreDatabaseModuleAdapter,
  createCoreLibraryDatabaseModuleAdapter,
} from "../core-client/database-module-adapter";
import { CoreModuleResponseError } from "../core-client/core-client";
import type { CoreClientPort, DatabaseRead, DatabaseReadSnapshot } from "../core-client/types";
import { CoreAuthority, CoreSessionAccess } from "../core-runtime/CoreAuthority";
import { CoreRuntimeError } from "../core-runtime/CoreRuntimeError";
import {
  type CoreMinimumCommitTimeout,
  type CoreStoreEpochMismatch,
  readCoreProjectionAtLeast,
  readCoreSnapshotAtLeast,
} from "../core-runtime/CoreMinimumCommit";
import {
  databaseListWindowRead,
  databaseViewGroupsRead,
  databaseViewWindowRead,
  DatabaseProjectionDescriptorError,
  listDescriptorRead,
  minimumCommitSeqForDatabaseProjection,
  projectDatabaseListWindow,
  projectDatabaseViewGroups,
  projectDatabaseViewReferenceModel,
  projectDatabaseViewWindow,
  viewDescriptorReads,
} from "./DatabaseProjection";

export class DatabaseModuleError extends Schema.TaggedError<DatabaseModuleError>()(
  "DatabaseModuleError",
  {
    operation: Schema.String,
    projectId: Schema.optional(Schema.String),
    cause: Schema.Defect(),
  },
) {}

type DatabaseEffect<A> = Effect.Effect<
  A,
  DatabaseModuleError | CoreStoreEpochMismatch | CoreMinimumCommitTimeout
>;

type ProjectScope<Access extends ContentAccessContext> = Access extends {
  readonly kind: "project";
}
  ? string
  : null;
type ConcreteProjectionTarget =
  | { readonly databaseViewId: string }
  | { readonly databaseId: string };
type ProjectionInput<Access extends ContentAccessContext, Input> = Access extends {
  readonly kind: "library";
}
  ? Input & ConcreteProjectionTarget
  : Input;

export class DatabaseModule extends Context.Service<
  DatabaseModule,
  {
    readonly read: (
      request: DatabaseModuleReadRequestV2,
    ) => DatabaseEffect<DatabaseModuleReadResultV2>;
    readonly apply: (request: DatabaseApplyV2) => DatabaseEffect<DatabaseApplyResultV2>;
    readonly readLibrary: (
      request: LibraryDatabaseModuleReadRequestV2,
    ) => DatabaseEffect<LibraryDatabaseModuleReadResultV2>;
    readonly applyLibrary: (
      request: LibraryDatabaseApplyV2,
    ) => DatabaseEffect<LibraryDatabaseApplyResultV2>;
    readonly viewWindow: <Access extends ContentAccessContext>(
      access: Access,
      input: ProjectionInput<Access, DatabaseViewWindowInput>,
    ) => DatabaseEffect<DatabaseViewWindowSnapshot<ProjectScope<Access>>>;
    readonly listWindow: <Access extends ContentAccessContext>(
      access: Access,
      input: ProjectionInput<Access, DatabaseListWindowInput>,
    ) => DatabaseEffect<DatabaseListWindowSnapshot<ProjectScope<Access>>>;
    readonly viewGroups: <Access extends ContentAccessContext>(
      access: Access,
      input: ProjectionInput<Access, DatabaseViewGroupsInput>,
    ) => DatabaseEffect<DatabaseViewGroupsSnapshot<ProjectScope<Access>>>;
    readonly resolveDatabaseViewReference: (
      input: ReadDatabaseViewReferenceInput,
    ) => DatabaseEffect<DatabaseViewReadModel | null>;
  }
>()("nodex/main/database-application/DatabaseModule") {}

export const live: Layer.Layer<DatabaseModule, never, CoreAuthority | CoreSessionAccess> =
  Layer.effect(
    DatabaseModule,
    Effect.gen(function* () {
      const authority = yield* CoreAuthority;
      const sessions = yield* CoreSessionAccess;
      const identity = authority.identity;
      const use = <A>(
        operation: string,
        projectId: string | undefined,
        run: (client: CoreClientPort, signal: AbortSignal) => Promise<A>,
      ): DatabaseEffect<A> =>
        sessions.use(operation, run, { ...(projectId ? { projectId } : {}) }).pipe(
          Effect.mapError(
            (cause) =>
              new DatabaseModuleError({
                operation,
                ...(projectId ? { projectId } : {}),
                cause,
              }),
          ),
        );
      const projectIdForAccess = (access: ContentAccessContext): string | undefined =>
        access.kind === "project" ? access.projectId : undefined;
      const projectScopeForAccess = <Access extends ContentAccessContext>(
        access: Access,
      ): ProjectScope<Access> =>
        (access.kind === "project" ? access.projectId : null) as ProjectScope<Access>;
      const projectAdapter = (client: CoreClientPort, projectId: string) =>
        createCoreDatabaseModuleAdapter({
          client,
          projectId,
          libraryId: identity.libraryId,
          storeEpoch: identity.storeEpoch,
        });
      const libraryAdapter = (client: CoreClientPort) =>
        createCoreLibraryDatabaseModuleAdapter({
          client,
          libraryId: identity.libraryId,
          storeEpoch: identity.storeEpoch,
        });
      const read = (
        request: DatabaseModuleReadRequestV2,
      ): DatabaseEffect<DatabaseModuleReadResultV2> => {
        const minimumCommitSeq = request.read.minimumCommitSeq ?? 0;
        const attempt = use("database.read", request.projectId, (client) =>
          projectAdapter(client, request.projectId).read({
            ...request,
            read: { ...request.read, minimumCommitSeq: 0 },
          }),
        );
        return readCoreProjectionAtLeast(
          attempt,
          identity.storeEpoch,
          minimumCommitSeq,
          (result) =>
            result.ok
              ? {
                  store_epoch: result.value.storeEpoch,
                  commit_head: result.value.commitSeq,
                }
              : null,
        );
      };
      const readLibrary = (
        request: LibraryDatabaseModuleReadRequestV2,
      ): DatabaseEffect<LibraryDatabaseModuleReadResultV2> => {
        const minimumCommitSeq = request.read.minimumCommitSeq ?? 0;
        const attempt = use("database.readLibrary", undefined, (client) =>
          libraryAdapter(client).read({
            read: { ...request.read, minimumCommitSeq: 0 } as LibraryDatabaseReadV2,
          }),
        );
        return readCoreProjectionAtLeast(
          attempt,
          identity.storeEpoch,
          minimumCommitSeq,
          (result) =>
            result.ok
              ? {
                  store_epoch: result.value.storeEpoch,
                  commit_head: result.value.commitSeq,
                }
              : null,
        );
      };
      const readProjection = (
        access: ContentAccessContext,
        operation: string,
        coreRead: DatabaseRead,
        minimumCommitSeq: number,
      ): DatabaseEffect<DatabaseReadSnapshot> => {
        const projectId = projectIdForAccess(access);
        return readCoreSnapshotAtLeast(
          use(operation, projectId, (client) => client.databaseRead(coreRead)),
          identity.storeEpoch,
          minimumCommitSeq,
        );
      };
      const descriptor = (
        access: ContentAccessContext,
        descriptorRead: Parameters<typeof read>[0]["read"],
      ) =>
        access.kind === "project"
          ? read({ projectId: access.projectId, read: descriptorRead })
          : readLibrary({ read: descriptorRead as LibraryDatabaseReadV2 });
      const evaluate = <A>(operation: string, run: () => A): DatabaseEffect<A> =>
        Effect.try({
          try: run,
          catch: (cause) => new DatabaseModuleError({ operation, cause }),
        });
      const validateProjectionAccess = (
        access: ContentAccessContext,
        input: DatabaseViewWindowInput | DatabaseListWindowInput | DatabaseViewGroupsInput,
      ): DatabaseEffect<void> => {
        if (access.kind === "project" || input.databaseViewId || input.databaseId) {
          return Effect.void;
        }
        return Effect.fail(
          new DatabaseModuleError({
            operation: "database.projection.authorize",
            cause: new Error("Library Database projections require a concrete Database or View"),
          }),
        );
      };
      const isUnavailableReference = (cause: unknown): boolean => {
        if (cause instanceof DatabaseProjectionDescriptorError) {
          return cause.code === "resource_not_found" || cause.code === "authorization_denied";
        }
        if (cause instanceof CoreModuleResponseError) {
          return cause.coreError.code === "not_found" || cause.coreError.code === "unauthorized";
        }
        if (cause instanceof DatabaseModuleError || cause instanceof CoreRuntimeError) {
          return isUnavailableReference(cause.cause);
        }
        return false;
      };
      const viewWindow = <Access extends ContentAccessContext>(
        access: Access,
        input: ProjectionInput<Access, DatabaseViewWindowInput>,
      ): DatabaseEffect<DatabaseViewWindowSnapshot<ProjectScope<Access>>> =>
        Effect.gen(function* () {
          yield* validateProjectionAccess(access, input);
          const minimumCommitSeq = minimumCommitSeqForDatabaseProjection(
            input,
            identity.storeEpoch,
          );
          const coreRead = yield* evaluate("database.viewWindow.request", () =>
            databaseViewWindowRead(input),
          );
          const snapshot = yield* readProjection(
            access,
            "database.viewWindow",
            coreRead,
            minimumCommitSeq,
          );
          const reads = yield* evaluate("database.viewWindow.descriptors", () =>
            viewDescriptorReads(snapshot),
          );
          const [view, database, dataSource] = yield* Effect.all([
            descriptor(access, reads.view),
            descriptor(access, reads.database),
            descriptor(access, reads.dataSource),
          ]);
          return yield* evaluate("database.viewWindow.project", () =>
            projectDatabaseViewWindow({
              projectId: projectScopeForAccess(access),
              libraryId: identity.libraryId,
              snapshot,
              view,
              database,
              dataSource,
            }),
          );
        });

      return DatabaseModule.of({
        read,
        apply: (request) =>
          use("database.apply", request.projectId, (client) =>
            projectAdapter(client, request.projectId).apply(request),
          ),
        readLibrary,
        applyLibrary: (request) =>
          use("database.applyLibrary", undefined, (client) =>
            libraryAdapter(client).apply(request),
          ),
        viewWindow,
        listWindow: (access, input) =>
          Effect.gen(function* () {
            yield* validateProjectionAccess(access, input);
            const minimumCommitSeq = minimumCommitSeqForDatabaseProjection(
              input,
              identity.storeEpoch,
            );
            const coreRead = yield* evaluate("database.listWindow.request", () =>
              databaseListWindowRead(input),
            );
            const snapshot = yield* readProjection(
              access,
              "database.listWindow",
              coreRead,
              minimumCommitSeq,
            );
            const dataSourceRead = yield* evaluate("database.listWindow.descriptor", () =>
              listDescriptorRead(snapshot),
            );
            const dataSource = yield* descriptor(access, dataSourceRead);
            return yield* evaluate("database.listWindow.project", () =>
              projectDatabaseListWindow({
                projectId: projectScopeForAccess(access),
                libraryId: identity.libraryId,
                snapshot,
                dataSource,
              }),
            );
          }),
        viewGroups: (access, input) =>
          Effect.gen(function* () {
            yield* validateProjectionAccess(access, input);
            const coreRead = yield* evaluate("database.viewGroups.request", () =>
              databaseViewGroupsRead(input),
            );
            const snapshot = yield* readProjection(
              access,
              "database.viewGroups",
              coreRead,
              minimumCommitSeqForDatabaseProjection(input, identity.storeEpoch),
            );
            return yield* evaluate("database.viewGroups.project", () =>
              projectDatabaseViewGroups({
                projectId: projectScopeForAccess(access),
                libraryId: identity.libraryId,
                snapshot,
              }),
            );
          }),
        resolveDatabaseViewReference: (input) => {
          let viewId: ReturnType<typeof parseDatabaseViewId>;
          try {
            viewId = parseDatabaseViewId(input.databaseViewId);
          } catch {
            return Effect.succeed(null);
          }
          return viewWindow(input.accessContext, { databaseViewId: viewId, first: 50 }).pipe(
            Effect.flatMap((window) =>
              evaluate("database.resolveDatabaseViewReference.project", () =>
                projectDatabaseViewReferenceModel(window, input),
              ),
            ),
            Effect.catch((error) =>
              isUnavailableReference(error) ? Effect.succeed(null) : Effect.fail(error),
            ),
          );
        },
      });
    }),
  );
