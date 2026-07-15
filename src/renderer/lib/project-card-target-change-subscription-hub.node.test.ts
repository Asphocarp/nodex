import { describe, expect, test, vi } from "vitest";
import type { CardTargetChangedEvent } from "../../shared/card-target-events";
import { createProjectCardTargetChangeSubscriptionHub } from "./project-card-target-change-subscription-hub";

describe("ProjectCardTargetChangeSubscriptionHub", () => {
  test("dispatches only matching identities and coalesces identical queries", () => {
    const projectStream: {
      listener: ((event: CardTargetChangedEvent) => void) | null;
    } = { listener: null };
    const unsubscribeProject = vi.fn();
    const hub = createProjectCardTargetChangeSubscriptionHub({
      subscribeToProject: (_projectId, listener) => {
        projectStream.listener = listener;
        return unsubscribeProject;
      },
    });
    const firstA = vi.fn();
    const secondA = vi.fn();
    const targetB = vi.fn();
    const unsubscribeFirst = hub.subscribe("project", "card-a", "query-a", firstA);
    const unsubscribeSecond = hub.subscribe("project", "card-a", "query-a", secondA);
    const unsubscribeB = hub.subscribe("project", "card-b", "query-b", targetB);

    projectStream.listener?.({
      projectId: "project",
      targetBlockId: "card-a",
      changeKind: "content",
    });

    expect(firstA).toHaveBeenCalledOnce();
    expect(secondA).not.toHaveBeenCalled();
    expect(targetB).not.toHaveBeenCalled();

    unsubscribeFirst();
    projectStream.listener?.({
      projectId: "project",
      targetBlockId: "card-a",
      changeKind: "lifecycle",
    });
    expect(secondA).toHaveBeenCalledOnce();

    unsubscribeSecond();
    expect(unsubscribeProject).not.toHaveBeenCalled();
    unsubscribeB();
    expect(unsubscribeProject).toHaveBeenCalledOnce();
  });
});
