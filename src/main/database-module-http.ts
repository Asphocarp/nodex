import { bodyLimit } from "hono/body-limit";
import type { Hono } from "hono";
import type {
  DatabaseApplyResultV2,
  DatabaseApplyV2,
  DatabaseModuleReadRequestV2,
  DatabaseModuleReadResultV2,
} from "../shared/database-module-v2";
import {
  bindDatabaseApplyV2,
  bindDatabaseModuleReadV2,
  databaseModuleFailureV2,
  databaseModuleHttpStatusV2,
} from "../shared/database-module-v2-transport";

const MAX_DATABASE_MODULE_HTTP_BYTES = 2_100_000;

export interface DatabaseModuleHttpDependencies {
  readonly apply: (request: DatabaseApplyV2) => Promise<DatabaseApplyResultV2>;
  readonly read: (
    request: DatabaseModuleReadRequestV2,
  ) => Promise<DatabaseModuleReadResultV2>;
}

const invalidRequest = (message: string): DatabaseModuleReadResultV2 => ({
  ok: false,
  error: databaseModuleFailureV2("invalid_request", message),
});

const transportFailure = (
  error: unknown,
  operationId?: string,
): DatabaseModuleReadResultV2 | DatabaseApplyResultV2 => ({
  ok: false,
  error: databaseModuleFailureV2(
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
      let request: DatabaseModuleReadRequestV2;
      try {
        request = bindDatabaseModuleReadV2(
          body,
          context.req.param("projectId"),
        );
      } catch (error) {
        const result = invalidRequest(
          error instanceof Error ? error.message : "Database Module read is invalid",
        );
        return context.json(result, 400);
      }
      let result: DatabaseModuleReadResultV2;
      try {
        result = await dependencies.read(request);
      } catch (error) {
        result = transportFailure(error) as DatabaseModuleReadResultV2;
      }
      return context.json(
        result,
        result.ok ? 200 : databaseModuleHttpStatusV2(result.error),
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
      let request: DatabaseApplyV2;
      try {
        request = bindDatabaseApplyV2(
          body,
          context.req.param("projectId"),
          { actor: { kind: "http_loopback", transport: "json" } },
        );
      } catch (error) {
        const result: DatabaseApplyResultV2 = {
          ok: false,
          error: databaseModuleFailureV2(
            "invalid_request",
            error instanceof Error
              ? error.message
              : "Database Module apply is invalid",
          ),
        };
        return context.json(result, 400);
      }
      let result: DatabaseApplyResultV2;
      try {
        result = await dependencies.apply(request);
      } catch (error) {
        result = transportFailure(
          error,
          request.operationId,
        ) as DatabaseApplyResultV2;
      }
      return context.json(
        result,
        result.ok ? 200 : databaseModuleHttpStatusV2(result.error),
      );
    },
  );
};
