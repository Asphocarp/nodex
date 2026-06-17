import { lazy, Suspense } from "react";

import type FloatingThreadControllerImplementation from "./FloatingThreadController.js";

const LazyFloatingThreadController = lazy(
  () => import("./FloatingThreadController.js"),
);

const FloatingThreadController = ((props) => (
  <Suspense fallback={null}>
    <LazyFloatingThreadController {...props} />
  </Suspense>
)) as typeof FloatingThreadControllerImplementation;

export default FloatingThreadController;
