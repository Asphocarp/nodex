import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { resolveRendererTransport } from "./renderer-transport";
import {
  ProjectionInvalidationRegistry,
  type ProjectionRegistration,
} from "./projection-invalidation-registry";

const ProjectionInvalidationContext = createContext<
  ProjectionInvalidationRegistry | null
>(null);
let activeProjectionInvalidationRegistry: ProjectionInvalidationRegistry | null = null;

export const getActiveProjectionInvalidationRegistry = () =>
  activeProjectionInvalidationRegistry;

export function ProjectionInvalidationProvider({
  children,
  registry: providedRegistry,
}: {
  readonly children: ReactNode;
  readonly registry?: ProjectionInvalidationRegistry;
}) {
  const [ownedRegistry] = useState(() => new ProjectionInvalidationRegistry(
    (scope, listener) =>
      resolveRendererTransport().subscribeProjectionStream(scope, listener),
  ));
  const registry = providedRegistry ?? ownedRegistry;
  activeProjectionInvalidationRegistry = registry;
  useEffect(() => () => {
    if (activeProjectionInvalidationRegistry === registry) {
      activeProjectionInvalidationRegistry = null;
    }
    if (!providedRegistry) registry.dispose();
  }, [providedRegistry, registry]);
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
