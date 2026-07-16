import type { Hono } from "hono";
import type { PageDetailResult } from "../shared/page-detail";

export interface PageDetailHttpDependencies {
  readonly read: (projectId: string, pageId: string) => Promise<PageDetailResult>;
}

const status = (result: PageDetailResult): 200 | 400 | 403 | 404 | 409 | 500 => {
  if (result.ok) return 200;
  if (result.error.code === "invalid_request") return 400;
  if (result.error.code === "authorization_denied") return 403;
  if (
    result.error.code === "project_not_found" ||
    result.error.code === "page_not_found"
  ) {
    return 404;
  }
  if (result.error.code === "store_not_initialized") return 409;
  return 500;
};

export const registerPageDetailHttpRoute = (
  app: Hono,
  dependencies: PageDetailHttpDependencies,
): void => {
  app.get("/api/projects/:projectId/pages/:pageId", async (context) => {
    context.header("Cache-Control", "no-store");
    let result: PageDetailResult;
    try {
      result = await dependencies.read(
        context.req.param("projectId"),
        context.req.param("pageId"),
      );
    } catch (error) {
      result = {
        ok: false,
        error: {
          code: "unknown",
          message: error instanceof Error ? error.message : "Page Detail is unavailable",
          retryable: true,
        },
      };
    }
    return context.json(result, status(result));
  });
};
