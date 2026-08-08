import type { ResourceRevocationRouter } from "./core-client/resource-revocation-router";

let router: ResourceRevocationRouter | null = null;

export const setResourceRevocationRouter = (
  next: ResourceRevocationRouter | null,
): void => {
  router?.dispose();
  router = next;
};

export const requireResourceRevocationRouter = (): ResourceRevocationRouter => {
  if (!router) throw new Error("Resource revocation authority is unavailable");
  return router;
};
