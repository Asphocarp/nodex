import { describe, expect, test, vi } from "vitest";

import type { ResourceRevocationMessage } from "../../shared/resource-revocation-stream";
import { ResourceRevocationRouter } from "./resource-revocation-router";
import { createCoreLocalCommitFixture } from "./testing/local-commit-fixture";

describe("ResourceRevocationRouter", () => {
  test("routes root revocations to the exact authorization audience", () => {
    const sourceMessages: ResourceRevocationMessage[] = [];
    const targetMessages: ResourceRevocationMessage[] = [];
    const libraryMessages: ResourceRevocationMessage[] = [];
    const router = new ResourceRevocationRouter({ libraryId: "library-1" });
    router.subscribe(
      { kind: "project", libraryId: "library-1", projectId: "project-a" },
      (message) => sourceMessages.push(message),
    );
    router.subscribe(
      { kind: "project", libraryId: "library-1", projectId: "project-b" },
      (message) => targetMessages.push(message),
    );
    router.subscribe(
      { kind: "library", libraryId: "library-1" },
      (message) => libraryMessages.push(message),
    );
    const projectRevocation = {
      authorization_scope: {
        kind: "project" as const,
        library_id: "library-1",
        project_id: "project-a",
      },
      resource_kind: "page" as const,
      resource_id: "page-1",
      reason: "ownership_moved" as const,
    };
    const libraryRevocation = {
      authorization_scope: {
        kind: "library" as const,
        library_id: "library-1",
      },
      resource_kind: "canvas" as const,
      resource_id: "canvas-1",
      reason: "deleted" as const,
    };
    const packet = createCoreLocalCommitFixture({
      commitSeq: 4,
      revocations: [projectRevocation, libraryRevocation],
    });

    router.publish(packet, projectRevocation);
    router.publish(packet, libraryRevocation);

    expect(sourceMessages).toEqual([expect.objectContaining({
      version: 1,
      stream: { storeEpoch: "epoch-1", commitSeq: 4 },
      delivery: expect.objectContaining({ revocation: projectRevocation }),
    })]);
    expect(targetMessages).toHaveLength(0);
    expect(libraryMessages).toEqual([expect.objectContaining({
      delivery: expect.objectContaining({ revocation: libraryRevocation }),
    })]);
  });

  test("keeps exact Document scopes on the Document revocation lane", () => {
    const listener = vi.fn();
    const router = new ResourceRevocationRouter({ libraryId: "library-1" });
    router.subscribe(
      { kind: "project", libraryId: "library-1", projectId: "project-a" },
      listener,
    );
    const revocation = {
      authorization_scope: {
        kind: "document" as const,
        library_id: "library-1",
        project_id: "project-a",
        document_id: "document-1",
      },
      resource_kind: "document" as const,
      resource_id: "document-1",
      reason: "access_revoked" as const,
    };
    const packet = createCoreLocalCommitFixture({ commitSeq: 5, revocations: [revocation] });

    router.publish(packet, revocation);

    expect(listener).not.toHaveBeenCalled();
  });
});
