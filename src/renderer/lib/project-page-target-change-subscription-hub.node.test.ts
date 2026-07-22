import { describe, expect, test, vi } from "vitest";
import type { PageTargetChangedEvent } from "../../shared/page-target-events";
import { createProjectPageTargetChangeSubscriptionHub } from "./project-page-target-change-subscription-hub";

describe("ProjectPageTargetChangeSubscriptionHub", () => {
  test("dispatches only matching identities and coalesces identical queries", () => {
    const projectStream: {
      listener: ((event: PageTargetChangedEvent) => void) | null;
    } = { listener: null };
    const unsubscribeProject = vi.fn();
    const hub = createProjectPageTargetChangeSubscriptionHub({
      subscribeToProject: (_projectId, listener) => {
        projectStream.listener = listener;
        return unsubscribeProject;
      },
    });
    const firstA = vi.fn();
    const secondA = vi.fn();
    const targetB = vi.fn();
    const unsubscribeFirst = hub.subscribe("project", "page-a", "query-a", firstA);
    const unsubscribeSecond = hub.subscribe("project", "page-a", "query-a", secondA);
    const unsubscribeB = hub.subscribe("project", "page-b", "query-b", targetB);

    projectStream.listener?.({
      version: 1,
      libraryId: "project",
      storeEpoch: "epoch",
      changeLogSeq: 1,
      targetPageId: "page-a",
      changeKind: "content",
      affectedDatabaseIds: [],
      affectedDataSourceIds: [],
    });

    expect(firstA).toHaveBeenCalledOnce();
    expect(secondA).not.toHaveBeenCalled();
    expect(targetB).not.toHaveBeenCalled();

    unsubscribeFirst();
    projectStream.listener?.({
      version: 1,
      libraryId: "project",
      storeEpoch: "epoch",
      changeLogSeq: 2,
      targetPageId: "page-a",
      changeKind: "lifecycle",
      affectedDatabaseIds: [],
      affectedDataSourceIds: [],
    });
    expect(secondA).toHaveBeenCalledOnce();

    unsubscribeSecond();
    expect(unsubscribeProject).not.toHaveBeenCalled();
    unsubscribeB();
    expect(unsubscribeProject).toHaveBeenCalledOnce();
  });
});
