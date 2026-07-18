import { bodyLimit } from "hono/body-limit";
import type { Hono } from "hono";

import type {
  LibraryModuleApplyRequest,
  LibraryModuleApplyResult,
  LibraryModuleReadRequest,
  LibraryModuleReadResult,
} from "../shared/library-module";
import {
  bindLibraryModuleApply,
  bindLibraryModuleRead,
  libraryModuleFailure,
  libraryModuleHttpStatus,
} from "../shared/library-module-transport";

const MAX_LIBRARY_MODULE_HTTP_BYTES = 64_000;

export interface LibraryModuleHttpDependencies {
  readonly read: (
    request: LibraryModuleReadRequest,
  ) => Promise<LibraryModuleReadResult>;
  readonly apply: (
    request: LibraryModuleApplyRequest,
  ) => Promise<LibraryModuleApplyResult>;
}

const invalidRequest = (message: string): LibraryModuleReadResult => ({
  ok: false,
  error: libraryModuleFailure("invalid_request", message),
});

const invalidApplyRequest = (message: string): LibraryModuleApplyResult => ({
  ok: false,
  error: libraryModuleFailure("invalid_request", message),
});

export const registerLibraryModuleHttpRoute = (
  app: Hono,
  dependencies: LibraryModuleHttpDependencies,
): void => {
  const limit = bodyLimit({
    maxSize: MAX_LIBRARY_MODULE_HTTP_BYTES,
    onError: (context) =>
      context.json(invalidRequest("Library read body is too large"), 400),
  });
  app.post("/api/library-module/read", limit, async (context) => {
    context.header("Cache-Control", "no-store");
    const body = await context.req.json().catch(() => null);
    if (body === null) {
      return context.json(
        invalidRequest("Library read body must be valid JSON"),
        400,
      );
    }
    let request: LibraryModuleReadRequest;
    try {
      request = bindLibraryModuleRead(body);
    } catch (error) {
      return context.json(
        invalidRequest(
          error instanceof Error ? error.message : "Library read is invalid",
        ),
        400,
      );
    }
    let result: LibraryModuleReadResult;
    try {
      result = await dependencies.read(request);
    } catch (error) {
      result = {
        ok: false,
        error: libraryModuleFailure(
          "unknown",
          error instanceof Error
            ? error.message
            : "The durable Library reader is unavailable",
          true,
        ),
      };
    }
    return context.json(
      result,
      result.ok ? 200 : libraryModuleHttpStatus(result.error),
    );
  });
  app.post("/api/library-module/apply", limit, async (context) => {
    context.header("Cache-Control", "no-store");
    const body = await context.req.json().catch(() => null);
    if (body === null) {
      return context.json(
        invalidApplyRequest("Library write body must be valid JSON"),
        400,
      );
    }
    let request: LibraryModuleApplyRequest;
    try {
      request = bindLibraryModuleApply(body);
    } catch (error) {
      return context.json(
        invalidApplyRequest(
          error instanceof Error ? error.message : "Library write is invalid",
        ),
        400,
      );
    }
    let result: LibraryModuleApplyResult;
    try {
      result = await dependencies.apply(request);
    } catch (error) {
      result = {
        ok: false,
        error: libraryModuleFailure(
          "unknown",
          error instanceof Error
            ? error.message
            : "The durable Library writer is unavailable",
          true,
        ),
      };
    }
    return context.json(
      result,
      result.ok ? 200 : libraryModuleHttpStatus(result.error),
    );
  });
};
