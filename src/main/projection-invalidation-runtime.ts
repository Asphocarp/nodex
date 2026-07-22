import type { ProjectionInvalidationRouter } from "./core-client/projection-invalidation-router";

let router: ProjectionInvalidationRouter | null = null;

export const setProjectionInvalidationRouter = (
  next: ProjectionInvalidationRouter | null,
): void => {
  if (router === next) return;
  router?.dispose();
  router = next;
};

export const requireProjectionInvalidationRouter = (): ProjectionInvalidationRouter => {
  if (!router) throw new Error("Projection invalidation authority is unavailable");
  return router;
};
