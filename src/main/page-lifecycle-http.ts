import { bodyLimit } from "hono/body-limit";
import type { Hono } from "hono";
import type {
  PageLifecycleMutationCommandResult,
  PageLifecycleMutationRequest,
} from "../shared/page-lifecycle";
import {
  bindTrustedPageLifecycleMutation,
  pageLifecycleMutationFailure,
  pageLifecycleMutationHttpStatus,
  pageLifecycleTransportFailure,
} from "../shared/page-lifecycle-transport";
import type { PageLifecyclePreflightResult } from "../shared/page-lifecycle-runtime";

const MAX_PAGE_LIFECYCLE_HTTP_BYTES = 2_100_000;

export interface PageLifecycleHttpDependencies {
  readonly applyMutation: (
    request: PageLifecycleMutationRequest,
  ) => Promise<PageLifecycleMutationCommandResult>;
}

export const registerPageLifecycleHttpRoute = (
  app: Hono,
  dependencies: PageLifecycleHttpDependencies,
): void => {
  app.post(
    "/api/projects/:projectId/page-lifecycle-mutations",
    bodyLimit({
      maxSize: MAX_PAGE_LIFECYCLE_HTTP_BYTES,
      onError: (context) =>
        context.json(
          {
            ok: false,
            error: pageLifecycleMutationFailure(
              "invalid_page_lifecycle_request",
              "Page lifecycle mutation body is too large",
            ),
          } satisfies PageLifecycleMutationCommandResult,
          400,
        ),
    }),
    async (context) => {
      context.header("Cache-Control", "no-store");
      const rawRequest = await context.req.json().catch(() => null);
      if (rawRequest === null) {
        const result: PageLifecycleMutationCommandResult = {
          ok: false,
          error: pageLifecycleMutationFailure(
            "invalid_page_lifecycle_request",
            "Page lifecycle mutation body must be valid JSON",
          ),
        };
        return context.json(result, 400);
      }
      const bound = bindTrustedPageLifecycleMutation(
        rawRequest,
        context.req.param("projectId"),
        { actor: { kind: "http_loopback" } },
      );
      if (!bound.ok) {
        return context.json(
          bound,
          pageLifecycleMutationHttpStatus(bound.error),
        );
      }
      let result: PageLifecycleMutationCommandResult;
      try {
        result = await dependencies.applyMutation(bound.value);
      } catch (error) {
        result = pageLifecycleTransportFailure(bound.value, error);
      }
      return context.json(
        result,
        result.ok ? 200 : pageLifecycleMutationHttpStatus(result.error),
      );
    },
  );
};

export interface PageLifecyclePreflightHttpDependencies {
  readonly readPreflight: (
    projectId: string,
    pageId: string,
  ) => Promise<PageLifecyclePreflightResult>;
}

export const registerPageLifecyclePreflightHttpRoute = (
  app: Hono,
  dependencies: PageLifecyclePreflightHttpDependencies,
): void => {
  app.get(
    "/api/projects/:projectId/page-lifecycle-preflight",
    async (context) => {
      context.header("Cache-Control", "no-store");
      const pageId = context.req.query("pageId") ?? "";
      const result = await dependencies.readPreflight(
        context.req.param("projectId"),
        pageId,
      );
      const status = result.ok
        ? 200
        : result.error.code === "authorization_denied"
          ? 403
          : result.error.code === "project_not_found" ||
              result.error.code === "page_not_found"
          ? 404
          : result.error.code === "unknown"
            ? 500
            : 400;
      return context.json(result, status);
    },
  );
};
