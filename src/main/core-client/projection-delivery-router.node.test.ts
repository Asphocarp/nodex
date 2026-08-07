import { describe, expect, test, vi } from "vitest";
import type { ProjectionStreamMessage } from "../../shared/projection-stream";
import type { CoreAuthorizedDeliveryPacket } from "./types";
import { ProjectionDeliveryRouter } from "./projection-delivery-router";
import { createCoreLocalCommitFixture } from "./testing/local-commit-fixture";

const effect = (
  projectId: string,
): CoreAuthorizedDeliveryPacket["projection_effects"][number] => ({
  scope: {
    schema_version: 1,
    canonical_key: `scope:${projectId}`,
    scope: {
      kind: "page",
      project_id: projectId,
      page_id: "page-1",
    },
  },
  base_revision: 0,
  result_revision: 1,
  covered_commit_seq: 1,
  patch: {
    kind: "page_changed",
    project_id: projectId,
    page_id: "page-1",
  },
  requires_read_at_least: true,
  effect_hash: "a".repeat(64),
});

const packet = (
  projectionEffect: CoreAuthorizedDeliveryPacket["projection_effects"][number],
) => createCoreLocalCommitFixture({
  commitSeq: 1,
  projectionEffects: [projectionEffect],
  projectionImpact: {
    kind: "resources",
    page_ids: ["page-1"],
    database_ids: [],
    data_source_ids: [],
    view_ids: [],
    document_heads: [],
  },
});

describe("ProjectionDeliveryRouter", () => {
  test("routes one authorized effect to its Project and Library subscriptions", () => {
    const projectMessages: ProjectionStreamMessage[] = [];
    const otherMessages: ProjectionStreamMessage[] = [];
    const libraryMessages: ProjectionStreamMessage[] = [];
    const router = new ProjectionDeliveryRouter({
      libraryId: "library-1",
      initialCursor: { storeEpoch: "epoch-1", commitSeq: 0 },
    });
    router.subscribe(
      { kind: "project", libraryId: "library-1", projectId: "project-1" },
      (message) => projectMessages.push(message),
    );
    router.subscribe(
      { kind: "project", libraryId: "library-1", projectId: "project-2" },
      (message) => otherMessages.push(message),
    );
    router.subscribe(
      { kind: "library", libraryId: "library-1" },
      (message) => libraryMessages.push(message),
    );

    const projectionEffect = effect("project-1");
    router.publish(packet(projectionEffect), projectionEffect);

    expect(projectMessages.map((message) => message.kind)).toEqual([
      "checkpoint",
      "effect",
    ]);
    expect(otherMessages.map((message) => message.kind)).toEqual(["checkpoint"]);
    expect(libraryMessages.map((message) => message.kind)).toEqual([
      "checkpoint",
      "effect",
    ]);
    expect(projectMessages[1]).toMatchObject({
      delivery: {
        effect: {
          scope: { canonical_key: "scope:project-1" },
          resultRevision: 1,
        },
      },
    });
  });

  test("publishes checkpoints and resets without an authorization read", () => {
    const messages: ProjectionStreamMessage[] = [];
    const router = new ProjectionDeliveryRouter({
      libraryId: "library-1",
      initialCursor: { storeEpoch: "epoch-1", commitSeq: 0 },
    });
    router.subscribe(
      { kind: "project", libraryId: "library-1", projectId: "project-1" },
      (message) => messages.push(message),
    );
    router.observeCheckpoint({ storeEpoch: "epoch-1", commitSeq: 8 });
    router.reset({ storeEpoch: "epoch-1", commitSeq: 9 }, "event_gap");

    expect(messages.map((message) => [message.kind, message.stream.commitSeq]))
      .toEqual([
        ["checkpoint", 0],
        ["checkpoint", 8],
        ["reset", 9],
      ]);
  });

  test("isolates listener failures", () => {
    const healthy = vi.fn();
    const listenerErrors = vi.fn();
    const router = new ProjectionDeliveryRouter({
      libraryId: "library-1",
      initialCursor: { storeEpoch: "epoch-1", commitSeq: 0 },
      onListenerError: listenerErrors,
    });
    const scope = {
      kind: "project" as const,
      libraryId: "library-1",
      projectId: "project-1",
    };
    router.subscribe(scope, () => {
      throw new Error("listener failed");
    });
    router.subscribe(scope, healthy);
    const projectionEffect = effect("project-1");
    router.publish(packet(projectionEffect), projectionEffect);

    expect(healthy).toHaveBeenCalledTimes(2);
    expect(listenerErrors).toHaveBeenCalledTimes(2);
  });
});
