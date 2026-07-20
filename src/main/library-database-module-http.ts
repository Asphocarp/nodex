import { bodyLimit } from "hono/body-limit";
import type { Hono } from "hono";
import type {
  LibraryDatabaseModuleReadResultV2,
  LibraryDatabaseModuleReadRequestV2,
  LibraryDatabaseApplyV2,
  LibraryDatabaseApplyResultV2,
} from "../shared/database-module-v2";
import {
  bindLibraryDatabaseApplyV2,
  bindLibraryDatabaseModuleReadV2,
} from "../shared/database-module-v2-transport";

const invalid = (message: string): LibraryDatabaseModuleReadResultV2 => ({
  ok: false,
  error: { code: "invalid_request", message, retryable: false },
});

export interface LibraryDatabaseModuleHttpDependencies {
  readonly read: (
    request: LibraryDatabaseModuleReadRequestV2,
  ) => Promise<LibraryDatabaseModuleReadResultV2>;
  readonly apply: (
    request: LibraryDatabaseApplyV2,
  ) => Promise<LibraryDatabaseApplyResultV2>;
}

export const registerLibraryDatabaseModuleHttpRoute = (
  app: Hono,
  dependencies: LibraryDatabaseModuleHttpDependencies,
): void => {
  app.post(
    "/api/library/database-module/read",
    bodyLimit({
      maxSize: 64_000,
      onError: (context) => context.json(invalid("Request body is too large"), 400),
    }),
    async (context) => {
      context.header("Cache-Control", "no-store");
      try {
        const request = bindLibraryDatabaseModuleReadV2(await context.req.json());
        const result = await dependencies.read(request);
        return context.json(result, result.ok ? 200 : 400);
      } catch (error) {
        return context.json(
          invalid(error instanceof Error ? error.message : "Library Database read is invalid"),
          400,
        );
      }
    },
  );
  app.post(
    "/api/library/database-module/apply",
    bodyLimit({
      maxSize: 256_000,
      onError: (context) => context.json(invalid("Request body is too large"), 400),
    }),
    async (context) => {
      context.header("Cache-Control", "no-store");
      try {
        const request = bindLibraryDatabaseApplyV2(await context.req.json(), {
          actor: { kind: "http_loopback" },
        });
        const result = await dependencies.apply(request);
        return context.json(result, result.ok ? 200 : 400);
      } catch (error) {
        return context.json(
          invalid(error instanceof Error ? error.message : "Library Database write is invalid"),
          400,
        );
      }
    },
  );
};
