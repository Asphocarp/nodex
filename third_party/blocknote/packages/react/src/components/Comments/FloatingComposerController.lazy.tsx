import { lazy, Suspense } from "react";

import type FloatingComposerControllerImplementation from "./FloatingComposerController.js";

const LazyFloatingComposerController = lazy(
  () => import("./FloatingComposerController.js"),
);

const FloatingComposerController = ((props) => (
  <Suspense fallback={null}>
    <LazyFloatingComposerController {...props} />
  </Suspense>
)) as typeof FloatingComposerControllerImplementation;

export default FloatingComposerController;
