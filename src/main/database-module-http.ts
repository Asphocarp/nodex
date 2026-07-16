import { bodyLimit } from "hono/body-limit";
import type { Hono } from "hono";
import type {
  DatabaseApply,
  DatabaseApplyResult,
  DatabaseModuleReadRequest,
  DatabaseModuleReadResult,
} from "../shared/database-module";
import {
  bindDatabaseApply,
  bindDatabaseModuleRead,
  databaseModuleFailure,
  databaseModuleHttpStatus,
} from "../shared/database-module-transport";

const MAX_DATABASE_MODULE_HTTP_BYTES = 2_100_000;

export interface DatabaseModuleHttpDependencies {
  readonly apply: (request: DatabaseApply) => Promise<DatabaseApplyResult>;
  readonly read: (
    request: DatabaseModuleReadRequest,
  ) => Promise<DatabaseModuleReadResult>;
}

const invalidRequest = (message: string): DatabaseModuleReadResult => ({
  ok: false,
  error: databaseModuleFailure("invalid_request", message),
});

const transportFailure = (
  error: unknown,
  operationId?: string,
): DatabaseModuleReadResult | DatabaseApplyResult => ({
  ok: false,
  error: databaseModuleFailure(
    "unknown",
    error instanceof Error
      ? error.message
      : "The durable Database Module is unavailable",
    operationId,
  ),
});

export const registerDatabaseModuleHttpRoutes = (
  app: Hono,
  dependencies: DatabaseModuleHttpDependencies,
): void => {
  const limit = bodyLimit({
    maxSize: MAX_DATABASE_MODULE_HTTP_BYTES,
    onError: (context) => {
      const result = invalidRequest("Database Module body is too large");
      return context.json(result, 400);
    },
  });

  app.post(
    "/api/projects/:projectId/database-module/read",
    limit,
    async (context) => {
      context.header("Cache-Control", "no-store");
      const body = await context.req.json().catch(() => null);
      if (body === null) {
        return context.json(
          invalidRequest("Database Module read body must be valid JSON"),
          400,
        );
      }
      let request: DatabaseModuleReadRequest;
      try {
        request = bindDatabaseModuleRead(
          body,
          context.req.param("projectId"),
        );
      } catch (error) {
        const result = invalidRequest(
          error instanceof Error ? error.message : "Database Module read is invalid",
        );
        return context.json(result, 400);
      }
      let result: DatabaseModuleReadResult;
      try {
        result = await dependencies.read(request);
      } catch (error) {
        result = transportFailure(error) as DatabaseModuleReadResult;
      }
      return context.json(
        result,
        result.ok ? 200 : databaseModuleHttpStatus(result.error),
      );
    },
  );

  app.post(
    "/api/projects/:projectId/database-module/apply",
    limit,
    async (context) => {
      context.header("Cache-Control", "no-store");
      const body = await context.req.json().catch(() => null);
      if (body === null) {
        return context.json(
          invalidRequest("Database Module apply body must be valid JSON"),
          400,
        );
      }
      let request: DatabaseApply;
      try {
        request = bindDatabaseApply(
          body,
          context.req.param("projectId"),
          { actor: { kind: "http_loopback", transport: "json" } },
        );
      } catch (error) {
        const result: DatabaseApplyResult = {
          ok: false,
          error: databaseModuleFailure(
            "invalid_request",
            error instanceof Error
              ? error.message
              : "Database Module apply is invalid",
          ),
        };
        return context.json(result, 400);
      }
      let result: DatabaseApplyResult;
      try {
        result = await dependencies.apply(request);
      } catch (error) {
        result = transportFailure(
          error,
          request.operationId,
        ) as DatabaseApplyResult;
      }
      return context.json(
        result,
        result.ok ? 200 : databaseModuleHttpStatus(result.error),
      );
    },
  );
};
