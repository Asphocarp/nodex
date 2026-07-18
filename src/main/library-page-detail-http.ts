import type { Hono } from "hono";

import type { LibraryPageDetailResult } from "../shared/page-detail";

export interface LibraryPageDetailHttpDependencies {
  readonly read: (pageId: string) => Promise<LibraryPageDetailResult>;
}

const status = (result: LibraryPageDetailResult): 200 | 400 | 403 | 404 | 409 | 500 => {
  if (result.ok) return 200;
  if (result.error.code === "invalid_request") return 400;
  if (result.error.code === "authorization_denied") return 403;
  if (result.error.code === "page_not_found") return 404;
  if (result.error.code === "store_not_initialized") return 409;
  return 500;
};

export const registerLibraryPageDetailHttpRoute = (
  app: Hono,
  dependencies: LibraryPageDetailHttpDependencies,
): void => {
  app.get("/api/library/pages/:pageId", async (context) => {
    context.header("Cache-Control", "no-store");
    let result: LibraryPageDetailResult;
    try {
      result = await dependencies.read(context.req.param("pageId"));
    } catch (error) {
      result = {
        ok: false,
        error: {
          code: "unknown",
          message: error instanceof Error
            ? error.message
            : "Library Page Detail is unavailable",
          retryable: true,
        },
      };
    }
    return context.json(result, status(result));
  });
};
