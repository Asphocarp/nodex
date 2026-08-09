import {
  createContext,
  useContext,
  useEffect,
  type ReactNode,
} from "react";
import {
  ProjectionInvalidationRegistry,
  type ProjectionRegistration,
} from "./projection-invalidation-registry";
import { getRendererProjectionInvalidationRegistry } from "./projection-invalidation-service";

const ProjectionInvalidationContext = createContext<
  ProjectionInvalidationRegistry | null
>(null);

export function ProjectionInvalidationProvider({
  children,
  registry: providedRegistry,
}: {
  readonly children: ReactNode;
  readonly registry?: ProjectionInvalidationRegistry;
}) {
  const registry = providedRegistry ?? getRendererProjectionInvalidationRegistry();
  return (
    <ProjectionInvalidationContext.Provider value={registry}>
      {children}
    </ProjectionInvalidationContext.Provider>
  );
}

export const useProjectionInvalidationRegistry = () => {
  const registry = useContext(ProjectionInvalidationContext);
  if (!registry) {
    throw new Error("Projection invalidation registry is unavailable");
  }
  return registry;
};

export const useProjectionRegistration = (
  registration: ProjectionRegistration | null,
): void => {
  const registry = useProjectionInvalidationRegistry();
  useEffect(() => {
    if (!registration) return;
    return registry.register(registration);
  }, [registration, registry]);
};
