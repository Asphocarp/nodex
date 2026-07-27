import type { Project } from "./types";

const projectUpdateTails = new Map<string, Promise<void>>();
const latestProjectResults = new Map<string, Project>();

/**
 * Serializes Project catalog writes across independent renderer surfaces.
 * Core still owns the revision fence; this queue prevents two local field
 * patches from reading the same revision and racing each other.
 */
export async function runSerializedProjectUpdate<T>(
  projectId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = projectUpdateTails.get(projectId) ?? Promise.resolve();
  const result = previous.catch(() => undefined).then(operation);
  const tail = result.then(
    () => undefined,
    () => undefined,
  );
  projectUpdateTails.set(projectId, tail);

  try {
    return await result;
  } finally {
    if (projectUpdateTails.get(projectId) === tail) {
      projectUpdateTails.delete(projectId);
    }
  }
}

export async function runSerializedProjectCatalogUpdate(
  projectId: string,
  operation: () => Promise<Project | null>,
): Promise<Project | null> {
  return runSerializedProjectUpdate(projectId, async () => {
    const project = await operation();
    if (project) latestProjectResults.set(projectId, project);
    return project;
  });
}

export async function waitForProjectCatalogUpdates(
  fallback: Project,
): Promise<Project> {
  while (true) {
    const tail = projectUpdateTails.get(fallback.id);
    if (!tail) break;

    await tail;
    if (projectUpdateTails.get(fallback.id) === tail) break;
  }

  const latest = latestProjectResults.get(fallback.id);
  if (!latest || latest.bindingRevision <= fallback.bindingRevision) {
    return fallback;
  }
  return latest;
}
