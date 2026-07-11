import { describe, expect, test } from "vitest";

import type { BlockMutationEnvelope } from "./block-mutation-writer";
import type { ProjectDeletionResult } from "./local-store/project-deletion";
import { createProjectDeletionRuntime } from "./project-deletion-runtime";

const envelope = (
  result: ProjectDeletionResult,
): BlockMutationEnvelope<ProjectDeletionResult> => ({
  result,
  events: [],
  metrics: {
    mutationId: "project-delete:test",
    queueWaitMs: 0,
    workerDurationMs: 1,
    transactionMs: 1,
    eventCount: 0,
  },
});

describe("Project deletion runtime", () => {
  test("revokes deleted Documents and publishes the Project change after the FIFO commit", async () => {
    const events: string[] = [];
    const runtime = createProjectDeletionRuntime({
      writer: {
        deleteProject: async (projectId) => {
          events.push(`writer:${projectId}`);
          return envelope({
            deleted: true,
            projectId,
            storeEpoch: "epoch-1",
            deletedDocumentIds: ["doc-1", "doc-2"],
            retiredBlockCount: 7,
          });
        },
      },
      resetDeletedDocuments: (documentIds, storeEpoch) => {
        events.push(`reset:${storeEpoch}:${documentIds.join(",")}`);
      },
      notifyProjectDeleted: (projectId) => {
        events.push(`notify:${projectId}`);
      },
    });

    expect(await runtime.deleteProject("project-1")).toBe(true);
    expect(events.join("|")).toBe(
      "writer:project-1|reset:epoch-1:doc-1,doc-2|notify:project-1",
    );
  });

  test("does not reset clients or notify when the Project does not exist", async () => {
    let postCommitCalls = 0;
    const runtime = createProjectDeletionRuntime({
      writer: {
        deleteProject: async (projectId) =>
          envelope({
            deleted: false,
            projectId,
            storeEpoch: "epoch-1",
            deletedDocumentIds: [],
            retiredBlockCount: 0,
          }),
      },
      resetDeletedDocuments: () => {
        postCommitCalls += 1;
      },
      notifyProjectDeleted: () => {
        postCommitCalls += 1;
      },
    });

    expect(await runtime.deleteProject("missing")).toBe(false);
    expect(postCommitCalls).toBe(0);
  });

  test("keeps a committed delete successful when one best-effort fanout fails", async () => {
    let notifications = 0;
    let postCommitErrors = 0;
    const runtime = createProjectDeletionRuntime({
      writer: {
        deleteProject: async (projectId) =>
          envelope({
            deleted: true,
            projectId,
            storeEpoch: "epoch-1",
            deletedDocumentIds: ["doc-1"],
            retiredBlockCount: 1,
          }),
      },
      resetDeletedDocuments: () => {
        throw new Error("simulated reset delivery failure");
      },
      notifyProjectDeleted: () => {
        notifications += 1;
      },
      onPostCommitError: () => {
        postCommitErrors += 1;
      },
    });

    expect(await runtime.deleteProject("project-1")).toBe(true);
    expect(notifications).toBe(1);
    expect(postCommitErrors).toBe(1);
  });
});
