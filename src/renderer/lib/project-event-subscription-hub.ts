export type ProjectEventListener = () => void;

type SubscribeToProject = (
  projectId: string,
  listener: ProjectEventListener,
) => () => void;

type ScheduleFlush = (flush: () => void) => void;

interface ConsumerRegistration {
  readonly id: number;
  readonly listener: ProjectEventListener;
}

interface ProjectSubscription {
  readonly consumers: Map<string, Map<number, ConsumerRegistration>>;
  unsubscribe: () => void;
  flushScheduled: boolean;
}

export interface ProjectEventSubscriptionHub {
  subscribe: (
    projectId: string,
    consumerKey: string,
    listener: ProjectEventListener,
  ) => () => void;
}

const scheduleMicrotask: ScheduleFlush = (flush) => {
  queueMicrotask(flush);
};

/**
 * Multiplexes a project-wide domain stream into distinct consumer refreshes.
 * A consumer key shares one callback across mounted observers while different
 * consumers remain independently refreshable.
 */
export const createProjectEventSubscriptionHub = ({
  subscribeToProject,
  schedule = scheduleMicrotask,
}: {
  readonly subscribeToProject: SubscribeToProject;
  readonly schedule?: ScheduleFlush;
}): ProjectEventSubscriptionHub => {
  const projects = new Map<string, ProjectSubscription>();
  let nextRegistrationId = 0;

  const scheduleProjectFlush = (
    projectId: string,
    project: ProjectSubscription,
  ): void => {
    if (project.flushScheduled) return;
    project.flushScheduled = true;

    schedule(() => {
      const currentProject = projects.get(projectId);
      if (currentProject !== project) return;
      project.flushScheduled = false;

      const listeners = [...project.consumers.values()]
        .map((registrations) => registrations.values().next().value)
        .filter((registration): registration is ConsumerRegistration =>
          registration !== undefined
        )
        .map((registration) => registration.listener);

      for (const listener of listeners) {
        try {
          listener();
        } catch {
          // A failed consumer refresh must not starve other consumers.
        }
      }
    });
  };

  const ensureProject = (projectId: string): ProjectSubscription => {
    const existingProject = projects.get(projectId);
    if (existingProject) return existingProject;

    const project: ProjectSubscription = {
      consumers: new Map(),
      unsubscribe: () => undefined,
      flushScheduled: false,
    };
    projects.set(projectId, project);
    project.unsubscribe = subscribeToProject(projectId, () => {
      scheduleProjectFlush(projectId, project);
    });
    return project;
  };

  const subscribe = (
    projectId: string,
    consumerKey: string,
    listener: ProjectEventListener,
  ): (() => void) => {
    const project = ensureProject(projectId);
    const registrationId = nextRegistrationId;
    nextRegistrationId += 1;

    const registrations = project.consumers.get(consumerKey) ?? new Map();
    registrations.set(registrationId, {
      id: registrationId,
      listener,
    });
    project.consumers.set(consumerKey, registrations);

    let active = true;
    return () => {
      if (!active) return;
      active = false;

      const currentProject = projects.get(projectId);
      if (currentProject !== project) return;

      const currentRegistrations = project.consumers.get(consumerKey);
      currentRegistrations?.delete(registrationId);
      if (currentRegistrations?.size === 0) {
        project.consumers.delete(consumerKey);
      }
      if (project.consumers.size > 0) return;

      projects.delete(projectId);
      project.unsubscribe();
    };
  };

  return { subscribe };
};
