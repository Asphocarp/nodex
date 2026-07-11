export type ProjectBoardChangeListener = () => void;

type SubscribeToProject = (
  projectId: string,
  listener: ProjectBoardChangeListener,
) => () => void;

type ScheduleFlush = (flush: () => void) => void;

interface ConsumerRegistration {
  readonly id: number;
  readonly listener: ProjectBoardChangeListener;
}

interface ProjectSubscription {
  readonly consumers: Map<string, Map<number, ConsumerRegistration>>;
  unsubscribe: () => void;
  flushScheduled: boolean;
}

export interface ProjectBoardChangeSubscriptionHub {
  subscribe: (
    projectId: string,
    consumerKey: string,
    listener: ProjectBoardChangeListener,
  ) => () => void;
}

const scheduleMicrotask: ScheduleFlush = (flush) => {
  queueMicrotask(flush);
};

/**
 * Multiplexes the project-wide board change stream into distinct query refreshes.
 * A query key is the consumer identity: multiple mounted observers of the same
 * query share one refresh, while different queries refresh independently.
 */
export const createProjectBoardChangeSubscriptionHub = ({
  subscribeToProject,
  schedule = scheduleMicrotask,
}: {
  readonly subscribeToProject: SubscribeToProject;
  readonly schedule?: ScheduleFlush;
}): ProjectBoardChangeSubscriptionHub => {
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
          // A failed query refresh must not starve the other query consumers.
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
    listener: ProjectBoardChangeListener,
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
