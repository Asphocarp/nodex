type Release = () => void;

interface ProjectGate {
  locked: boolean;
  readonly waiters: Array<() => void>;
}

/**
 * Serializes Project lifecycle commits with admission of new Project-owned
 * runtime work. Callers must revalidate durable Project lifecycle after the
 * gate is acquired and before starting the runtime.
 */
export class ProjectRuntimeLifecycleCoordinator {
  private readonly gates = new Map<string, ProjectGate>();

  async acquire(projectId: string | null): Promise<Release> {
    if (!projectId) return () => undefined;

    const gate = this.gates.get(projectId) ?? { locked: false, waiters: [] };
    this.gates.set(projectId, gate);
    if (gate.locked) {
      await new Promise<void>((resolve) => gate.waiters.push(resolve));
    } else {
      gate.locked = true;
    }

    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = gate.waiters.shift();
      if (next) {
        next();
        return;
      }
      gate.locked = false;
      this.gates.delete(projectId);
    };
  }

  async runExclusive<Result>(
    projectId: string | null,
    operation: () => Promise<Result> | Result,
  ): Promise<Result> {
    const release = await this.acquire(projectId);
    try {
      return await operation();
    } finally {
      release();
    }
  }
}

export const projectRuntimeLifecycleCoordinator =
  new ProjectRuntimeLifecycleCoordinator();
