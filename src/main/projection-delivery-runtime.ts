import type { ProjectionDeliveryRouter } from "./core-client/projection-delivery-router";

let router: ProjectionDeliveryRouter | null = null;

export const setProjectionDeliveryRouter = (
  next: ProjectionDeliveryRouter | null,
): void => {
  router?.dispose();
  router = next;
};

export const requireProjectionDeliveryRouter = (): ProjectionDeliveryRouter => {
  if (!router) throw new Error("Projection delivery authority is unavailable");
  return router;
};
