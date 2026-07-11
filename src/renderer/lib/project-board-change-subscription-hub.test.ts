import { describe, expect, test } from "bun:test";
import { createProjectBoardChangeSubscriptionHub } from "./project-board-change-subscription-hub";

describe("ProjectBoardChangeSubscriptionHub", () => {
  test("pools a Project stream and refreshes every distinct query once per burst", () => {
    const projectListeners = new Map<string, () => void>();
    const scheduledFlushes: Array<() => void> = [];
    let subscribeCalls = 0;
    let unsubscribeCalls = 0;
    const hub = createProjectBoardChangeSubscriptionHub({
      subscribeToProject: (projectId, listener) => {
        subscribeCalls += 1;
        projectListeners.set(projectId, listener);
        return () => {
          unsubscribeCalls += 1;
          if (projectListeners.get(projectId) === listener) {
            projectListeners.delete(projectId);
          }
        };
      },
      schedule: (flush) => {
        scheduledFlushes.push(flush);
      },
    });

    const refreshCounts = new Map<string, number>();
    const unsubscribers: Array<() => void> = [];
    const register = (consumerKey: string): void => {
      unsubscribers.push(hub.subscribe("project-1", consumerKey, () => {
        refreshCounts.set(
          consumerKey,
          (refreshCounts.get(consumerKey) ?? 0) + 1,
        );
      }));
    };

    for (let index = 0; index < 10; index += 1) {
      register(`card:${index}`);
      register(`view:${index}`);
    }
    register("card:0");

    expect(subscribeCalls).toBe(1);
    expect(projectListeners.size).toBe(1);

    projectListeners.get("project-1")?.();
    projectListeners.get("project-1")?.();
    projectListeners.get("project-1")?.();
    expect(scheduledFlushes.length).toBe(1);

    scheduledFlushes.shift()?.();
    expect(refreshCounts.size).toBe(20);
    expect(
      [...refreshCounts.values()].every((refreshCount) => refreshCount === 1),
    ).toBeTrue();
    expect(refreshCounts.get("card:0")).toBe(1);

    for (const unsubscribe of unsubscribers.slice(0, -1)) {
      unsubscribe();
    }
    expect(unsubscribeCalls).toBe(0);
    expect(projectListeners.size).toBe(1);

    projectListeners.get("project-1")?.();
    scheduledFlushes.shift()?.();
    expect(refreshCounts.get("card:0")).toBe(2);

    unsubscribers.at(-1)?.();
    expect(unsubscribeCalls).toBe(1);
    expect(projectListeners.size).toBe(0);
  });

  test("isolates Project streams and cancels a queued flush after last unmount", () => {
    const projectListeners = new Map<string, () => void>();
    const scheduledFlushes: Array<() => void> = [];
    const hub = createProjectBoardChangeSubscriptionHub({
      subscribeToProject: (projectId, listener) => {
        projectListeners.set(projectId, listener);
        return () => {
          projectListeners.delete(projectId);
        };
      },
      schedule: (flush) => {
        scheduledFlushes.push(flush);
      },
    });
    let alphaRefreshes = 0;
    let betaRefreshes = 0;
    const unsubscribeAlpha = hub.subscribe("alpha", "shared-key", () => {
      alphaRefreshes += 1;
    });
    hub.subscribe("beta", "shared-key", () => {
      betaRefreshes += 1;
    });

    expect(projectListeners.size).toBe(2);
    projectListeners.get("alpha")?.();
    unsubscribeAlpha();
    scheduledFlushes.shift()?.();
    expect(alphaRefreshes).toBe(0);
    expect(betaRefreshes).toBe(0);

    projectListeners.get("beta")?.();
    scheduledFlushes.shift()?.();
    expect(alphaRefreshes).toBe(0);
    expect(betaRefreshes).toBe(1);
  });
});
