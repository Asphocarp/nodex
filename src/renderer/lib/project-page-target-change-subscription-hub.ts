import type { PageTargetChangedEvent } from "../../shared/page-target-events";

type Listener = (event: PageTargetChangedEvent) => void;
type SubscribeToProject = (
  projectId: string,
  listener: Listener,
) => () => void;

interface ProjectSubscription {
  readonly consumers: Map<string, Map<string, Map<number, Listener>>>;
  unsubscribe: () => void;
}

export interface ProjectPageTargetChangeSubscriptionHub {
  subscribe: (
    projectId: string,
    targetPageId: string,
    consumerKey: string,
    listener: Listener,
  ) => () => void;
}

/** Multiplex one Project stream and dispatch only to the changed Page identity. */
export const createProjectPageTargetChangeSubscriptionHub = ({
  subscribeToProject,
}: {
  readonly subscribeToProject: SubscribeToProject;
}): ProjectPageTargetChangeSubscriptionHub => {
  const projects = new Map<string, ProjectSubscription>();
  let nextRegistrationId = 0;

  const ensureProject = (projectId: string): ProjectSubscription => {
    const existing = projects.get(projectId);
    if (existing) return existing;

    const project: ProjectSubscription = {
      consumers: new Map(),
      unsubscribe: () => undefined,
    };
    projects.set(projectId, project);
    project.unsubscribe = subscribeToProject(projectId, (event) => {
      const consumerGroups = project.consumers.get(event.targetPageId);
      if (!consumerGroups) return;
      for (const registrations of consumerGroups.values()) {
        const listener = registrations.values().next().value;
        if (!listener) continue;
        try {
          listener(event);
        } catch {
          // One invalidation cannot starve other query consumers.
        }
      }
    });
    return project;
  };

  const subscribe = (
    projectId: string,
    targetPageId: string,
    consumerKey: string,
    listener: Listener,
  ): (() => void) => {
    const project = ensureProject(projectId);
    const targetConsumers = project.consumers.get(targetPageId) ?? new Map();
    const registrations = targetConsumers.get(consumerKey) ?? new Map();
    const registrationId = nextRegistrationId;
    nextRegistrationId += 1;
    registrations.set(registrationId, listener);
    targetConsumers.set(consumerKey, registrations);
    project.consumers.set(targetPageId, targetConsumers);

    let active = true;
    return () => {
      if (!active) return;
      active = false;
      const current = projects.get(projectId);
      if (current !== project) return;
      const currentTarget = project.consumers.get(targetPageId);
      const currentRegistrations = currentTarget?.get(consumerKey);
      currentRegistrations?.delete(registrationId);
      if (currentRegistrations?.size === 0) currentTarget?.delete(consumerKey);
      if (currentTarget?.size === 0) project.consumers.delete(targetPageId);
      if (project.consumers.size > 0) return;
      projects.delete(projectId);
      project.unsubscribe();
    };
  };

  return { subscribe };
};
