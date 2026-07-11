import { bodyLimit } from "hono/body-limit";
import type { Hono } from "hono";
import type {
  DatabaseMutationCommandResult,
  DatabaseMutationRequest,
} from "../shared/database-kernel";
import type {
  DatabaseCatalogSnapshotCommandResult,
  DatabaseReadCommandResult,
  DatabaseViewSnapshotCommandResult,
  GeneralDatabaseDescriptor,
  GeneralDatabaseViewQuery,
  PrimaryDatabaseViewSnapshotCommandResult,
} from "../shared/database-query";
import {
  bindDatabaseMutationToProject,
  bindDatabaseReadIdentity,
  databaseMutationFailure,
  databaseMutationHttpStatus,
  databaseReadFailure,
  databaseReadHttpStatus,
  databaseTransportFailure,
} from "../shared/database-transport";

const MAX_DATABASE_MUTATION_HTTP_BYTES = 2_100_000;
const HTTP_CLIENT_SESSION_ID = "http-loopback";

export interface DatabaseKernelHttpDependencies {
  readonly applyMutation: (
    request: DatabaseMutationRequest,
  ) => Promise<DatabaseMutationCommandResult>;
  readonly readDescriptor: (
    projectId: string,
    databaseBlockId: string,
  ) => Promise<DatabaseReadCommandResult<GeneralDatabaseDescriptor>>;
  readonly readCatalog: (
    projectId: string,
  ) => Promise<DatabaseCatalogSnapshotCommandResult>;
  readonly readPrimaryDescriptor: (
    projectId: string,
  ) => Promise<DatabaseReadCommandResult<GeneralDatabaseDescriptor>>;
  readonly readPrimaryViewSnapshot: (
    projectId: string,
  ) => Promise<PrimaryDatabaseViewSnapshotCommandResult>;
  readonly readViewSnapshot?: (
    projectId: string,
    viewId: string,
  ) => Promise<DatabaseViewSnapshotCommandResult>;
  readonly queryView: (
    projectId: string,
    viewId: string,
  ) => Promise<DatabaseReadCommandResult<GeneralDatabaseViewQuery>>;
}

const readFailure = <T>(error: unknown): DatabaseReadCommandResult<T> => ({
  ok: false,
  error: databaseReadFailure(
    "unknown",
    error instanceof Error
      ? error.message
      : "The Database reader is unavailable",
    true,
  ),
});

export const registerDatabaseKernelHttpRoutes = (
  app: Hono,
  dependencies: DatabaseKernelHttpDependencies,
): void => {
  app.post(
    "/api/projects/:projectId/database-mutations",
    bodyLimit({
      maxSize: MAX_DATABASE_MUTATION_HTTP_BYTES,
      onError: (context) =>
        context.json(
          {
            ok: false,
            error: databaseMutationFailure(
              "invalid_database_mutation_request",
              "Database mutation body is too large",
            ),
          } satisfies DatabaseMutationCommandResult,
          400,
        ),
    }),
    async (context) => {
      context.header("Cache-Control", "no-store");
      const rawRequest = await context.req.json().catch(() => null);
      if (rawRequest === null) {
        const result: DatabaseMutationCommandResult = {
          ok: false,
          error: databaseMutationFailure(
            "invalid_database_mutation_request",
            "Database mutation body must be valid JSON",
          ),
        };
        return context.json(result, 400);
      }
      const bound = bindDatabaseMutationToProject(
        rawRequest,
        context.req.param("projectId"),
        {
          actor: { kind: "http_loopback", transport: "json" },
          clientSessionId: HTTP_CLIENT_SESSION_ID,
        },
      );
      if (!bound.ok) {
        return context.json(bound, databaseMutationHttpStatus(bound.error));
      }
      let result: DatabaseMutationCommandResult;
      try {
        result = await dependencies.applyMutation(bound.value);
      } catch (error) {
        result = databaseTransportFailure(bound.value, error);
      }
      return context.json(
        result,
        result.ok ? 200 : databaseMutationHttpStatus(result.error),
      );
    },
  );

  app.get(
    "/api/projects/:projectId/databases",
    async (context) => {
      context.header("Cache-Control", "no-store");
      const bound = bindDatabaseReadIdentity(
        context.req.param("projectId"),
        "catalog",
      );
      if (!bound.ok) {
        const result: DatabaseCatalogSnapshotCommandResult = bound;
        return context.json(result, databaseReadHttpStatus(result));
      }
      let result: DatabaseCatalogSnapshotCommandResult;
      try {
        result = await dependencies.readCatalog(bound.value.projectId);
      } catch (error) {
        result = readFailure(error);
      }
      return context.json(result, databaseReadHttpStatus(result));
    },
  );

  app.get(
    "/api/projects/:projectId/databases/primary",
    async (context) => {
      context.header("Cache-Control", "no-store");
      const bound = bindDatabaseReadIdentity(
        context.req.param("projectId"),
        "primary",
      );
      if (!bound.ok) {
        const result: DatabaseReadCommandResult<GeneralDatabaseDescriptor> =
          bound;
        return context.json(result, databaseReadHttpStatus(result));
      }
      let result: DatabaseReadCommandResult<GeneralDatabaseDescriptor>;
      try {
        result = await dependencies.readPrimaryDescriptor(
          bound.value.projectId,
        );
      } catch (error) {
        result = readFailure(error);
      }
      return context.json(result, databaseReadHttpStatus(result));
    },
  );

  app.get(
    "/api/projects/:projectId/database-views/primary/snapshot",
    async (context) => {
      context.header("Cache-Control", "no-store");
      const bound = bindDatabaseReadIdentity(
        context.req.param("projectId"),
        "primary-view",
      );
      if (!bound.ok) {
        const result: PrimaryDatabaseViewSnapshotCommandResult = bound;
        return context.json(result, databaseReadHttpStatus(result));
      }
      let result: PrimaryDatabaseViewSnapshotCommandResult;
      try {
        result = await dependencies.readPrimaryViewSnapshot(
          bound.value.projectId,
        );
      } catch (error) {
        result = {
          ok: false,
          error: databaseReadFailure(
            "unknown",
            error instanceof Error
              ? error.message
              : "The primary Database View snapshot is unavailable",
            true,
          ),
        };
      }
      return context.json(result, databaseReadHttpStatus(result));
    },
  );

  app.get(
    "/api/projects/:projectId/database-views/:viewId/snapshot",
    async (context) => {
      context.header("Cache-Control", "no-store");
      const bound = bindDatabaseReadIdentity(
        context.req.param("projectId"),
        context.req.param("viewId"),
      );
      if (!bound.ok) {
        const result: DatabaseViewSnapshotCommandResult = bound;
        return context.json(result, databaseReadHttpStatus(result));
      }
      if (!dependencies.readViewSnapshot) {
        const result: DatabaseViewSnapshotCommandResult = {
          ok: false,
          error: databaseReadFailure(
            "unknown",
            "The Database View snapshot reader is unavailable",
            true,
          ),
        };
        return context.json(result, databaseReadHttpStatus(result));
      }
      let result: DatabaseViewSnapshotCommandResult;
      try {
        result = await dependencies.readViewSnapshot(
          bound.value.projectId,
          bound.value.resourceId,
        );
      } catch {
        result = {
          ok: false,
          error: databaseReadFailure(
            "unknown",
            "The Database View snapshot is unavailable",
            true,
          ),
        };
      }
      return context.json(result, databaseReadHttpStatus(result));
    },
  );

  app.get(
    "/api/projects/:projectId/databases/:databaseBlockId",
    async (context) => {
      context.header("Cache-Control", "no-store");
      const bound = bindDatabaseReadIdentity(
        context.req.param("projectId"),
        context.req.param("databaseBlockId"),
      );
      if (!bound.ok) {
        const result: DatabaseReadCommandResult<GeneralDatabaseDescriptor> =
          bound;
        return context.json(result, databaseReadHttpStatus(result));
      }
      let result: DatabaseReadCommandResult<GeneralDatabaseDescriptor>;
      try {
        result = await dependencies.readDescriptor(
          bound.value.projectId,
          bound.value.resourceId,
        );
      } catch (error) {
        result = readFailure(error);
      }
      return context.json(result, databaseReadHttpStatus(result));
    },
  );

  app.get(
    "/api/projects/:projectId/database-views/:viewId/query",
    async (context) => {
      context.header("Cache-Control", "no-store");
      const bound = bindDatabaseReadIdentity(
        context.req.param("projectId"),
        context.req.param("viewId"),
      );
      if (!bound.ok) {
        const result: DatabaseReadCommandResult<GeneralDatabaseViewQuery> =
          bound;
        return context.json(result, databaseReadHttpStatus(result));
      }
      let result: DatabaseReadCommandResult<GeneralDatabaseViewQuery>;
      try {
        result = await dependencies.queryView(
          bound.value.projectId,
          bound.value.resourceId,
        );
      } catch (error) {
        result = readFailure(error);
      }
      return context.json(result, databaseReadHttpStatus(result));
    },
  );
};
