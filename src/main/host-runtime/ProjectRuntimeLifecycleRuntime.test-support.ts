interface ProjectRuntimeLifecycleTestAdapter {
  readonly runExclusive: <A>(
    projectId: string | null,
    operation: () => A | Promise<A>,
  ) => Promise<A>;
}

export interface ProjectRuntimeLifecycleTestHarness {
  readonly adapter: ProjectRuntimeLifecycleTestAdapter;
  readonly close: () => Promise<void>;
}

export const makeProjectRuntimeLifecycleTestHarness = (): ProjectRuntimeLifecycleTestHarness => {
  const tails = new Map<string, Promise<void>>();
  let closed = false;
  const adapter: ProjectRuntimeLifecycleTestAdapter = {
    runExclusive: async (projectId, operation) => {
      if (closed) throw new Error("Project runtime lifecycle test harness is closed");
      const key = projectId?.trim() || "";
      if (!key) return await operation();

      const previous = tails.get(key) ?? Promise.resolve();
      let release!: () => void;
      const current = new Promise<void>((resolve) => {
        release = resolve;
      });
      const tail = previous.catch(() => undefined).then(() => current);
      tails.set(key, tail);
      await previous.catch(() => undefined);
      try {
        return await operation();
      } finally {
        release();
        if (tails.get(key) === tail) tails.delete(key);
      }
    },
  };
  return {
    adapter,
    close: async () => {
      if (closed) return;
      closed = true;
      await Promise.allSettled(tails.values());
      tails.clear();
    },
  };
};
