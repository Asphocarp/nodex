export interface SessionThreadLaunchPresentation {
  readonly rendererLaunchPending?: boolean;
  readonly waitForFirstVisibleTurn?: boolean;
  readonly hasVisibleFirstTurn?: boolean;
}

/**
 * A freshly linked Session remains visually detached until its initiating
 * renderer has committed the first optimistic turn. This keeps the composer
 * draft or the optimistic transcript continuously visible across the durable
 * Session-link update.
 */
export function resolvePresentedSessionThread<Thread>(
  attachedThread: Thread | null,
  launch: SessionThreadLaunchPresentation | null,
): Thread | null {
  if (launch?.rendererLaunchPending === true) return null;
  if (
    launch?.waitForFirstVisibleTurn === true
    && launch.hasVisibleFirstTurn !== true
  ) {
    return null;
  }
  return attachedThread;
}
