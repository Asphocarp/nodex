import { describe, expect, test, vi } from "vitest";

import type { CoreLocalCommitEnvelope } from "./types";
import { LocalCommitDispatcher } from "./local-commit-dispatcher";

const commit = (
  commitSeq: number,
  canonicalHash = String(commitSeq).padStart(64, "0"),
): CoreLocalCommitEnvelope => {
  const payload = {
    module: "project_workspace" as const,
    event: {
      kind: "workspace_changed" as const,
      project_catalog_change: null,
      project_ids: [],
      session_ids: [],
      thread_ids: [],
      session_summary_scopes: [],
      session_detail_ids: [],
    },
  };
  return {
    event_version: 3,
    commit_seq: commitSeq,
    store_epoch: "epoch-1",
    operation_id: `operation-${commitSeq}`,
    committed_at: "2026-08-06T00:00:00.000Z",
    projection_impact: { kind: "none" },
    payload,
    effects: [{
      event_version: 3,
      sequence: commitSeq,
      store_epoch: "epoch-1",
      operation_id: `operation-${commitSeq}`,
      committed_at: "2026-08-06T00:00:00.000Z",
      projection_impact: { kind: "none" },
      payload,
    }],
    canonical_hash: canonicalHash,
  };
};

const flush = async (): Promise<void> => {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
};

describe("LocalCommitDispatcher", () => {
  test("runs the apply admission callback before accept returns", () => {
    const admitted: number[] = [];
    const dispatcher = new LocalCommitDispatcher({
      onAdmitted: (value) => admitted.push(value.commit_seq),
      onCommit: () => undefined,
    });

    dispatcher.accept(commit(1), "apply");

    expect(admitted).toEqual([1]);
  });

  test("does not make apply response wait for projection, while tailer waits in order", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const delivered: number[] = [];
    const dispatcher = new LocalCommitDispatcher({
      onCommit: async (value) => {
        delivered.push(value.commit_seq);
        if (value.commit_seq === 1) await gate;
      },
    });

    const applyAdmission = dispatcher.accept(commit(1), "apply");
    expect(applyAdmission.kind).toBe("accepted");
    await flush();
    expect(delivered).toEqual([1]);

    const tailerAdmission = dispatcher.accept(commit(2), "tailer");
    expect(tailerAdmission.kind).toBe("accepted");
    const idle = dispatcher.waitForIdle();
    await Promise.resolve();

    expect(delivered).toEqual([1]);
    release();
    await idle;
    expect(delivered).toEqual([1, 2]);

    expect(dispatcher.accept(commit(1), "tailer").kind).toBe("duplicate");
    expect(delivered).toEqual([1, 2]);
  });

  test("rejects a hash collision for the same durable identity", async () => {
    const dispatcher = new LocalCommitDispatcher({
      onCommit: () => undefined,
    });
    dispatcher.accept(commit(4), "tailer");
    await dispatcher.waitForIdle();

    expect(() => dispatcher.accept(commit(4, "f".repeat(64)), "tailer")).toThrow(
      "identity collision",
    );
  });

  test("allows the durable tailer to retry after a delivery failure", async () => {
    let attempts = 0;
    const delivered: number[] = [];
    const errors: unknown[] = [];
    const dispatcher = new LocalCommitDispatcher({
      onCommit: async (value) => {
        attempts += 1;
        if (attempts === 1) throw new Error("temporary fanout failure");
        delivered.push(value.commit_seq);
      },
      onError: (error) => errors.push(error),
      maxDeliveryAttempts: 1,
    });

    dispatcher.accept(commit(5), "tailer");
    await dispatcher.waitForIdle();
    expect(errors).toHaveLength(1);
    dispatcher.accept(commit(5), "replay");
    await dispatcher.waitForIdle();

    expect(attempts).toBe(2);
    expect(delivered).toEqual([5]);
  });

  test("keeps N and N+1 identities when they arrive out of order", async () => {
    const delivered: number[] = [];
    const dispatcher = new LocalCommitDispatcher({
      onCommit: (value) => {
        delivered.push(value.commit_seq);
      },
    });

    expect(dispatcher.accept(commit(12), "apply").kind).toBe("accepted");
    expect(dispatcher.accept(commit(11), "tailer").kind).toBe("accepted");
    await dispatcher.waitForIdle();

    expect(delivered).toEqual([12, 11]);
    expect(dispatcher.accept(commit(12), "tailer").kind).toBe("duplicate");
    expect(dispatcher.accept(commit(11), "replay").kind).toBe("duplicate");
  });

  test("admits a richer same-identity envelope before delivery starts", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const delivered: CoreLocalCommitEnvelope[] = [];
    const enriched: CoreLocalCommitEnvelope[] = [];
    const dispatcher = new LocalCommitDispatcher({
      onEnriched: (value) => {
        enriched.push(value);
      },
      onCommit: async (value) => {
        delivered.push(value);
        await gate;
      },
    });

    const sparse = commit(13);
    const rich = {
      ...sparse,
      projection_impact: {
        kind: "resources",
        page_ids: ["page-1"],
        database_ids: ["database-1"],
        data_source_ids: ["source-1"],
        view_ids: ["view-1"],
        document_heads: [],
      } as unknown as CoreLocalCommitEnvelope["projection_impact"],
    };
    expect(dispatcher.accept(sparse, "apply").kind).toBe("accepted");
    expect(dispatcher.accept(rich, "tailer").kind).toBe("enriched");
    expect(enriched).toEqual([rich]);
    await flush();
    expect(delivered).toHaveLength(1);
    expect(delivered[0]?.projection_impact.kind).toBe("resources");
    release();
    await dispatcher.waitForIdle();
  });

  test("reports asynchronous enrichment failures instead of creating an unhandled rejection", async () => {
    const errors: unknown[] = [];
    const dispatcher = new LocalCommitDispatcher({
      onCommit: () => undefined,
      onEnriched: async () => {
        throw new Error("enrichment failed");
      },
      onError: (error) => errors.push(error),
    });

    dispatcher.accept(commit(14), "tailer");
    await dispatcher.waitForIdle();
    dispatcher.accept({
      ...commit(14),
      projection_impact: {
        kind: "resources",
        page_ids: ["page-14"],
        database_ids: [],
        data_source_ids: [],
        view_ids: [],
        document_heads: [],
      },
    }, "apply");
    await flush();

    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ message: "enrichment failed" });
  });

  test("does not rebroadcast an equivalent tailer envelope after apply admission", async () => {
    const enriched = vi.fn();
    const delivered: number[] = [];
    const dispatcher = new LocalCommitDispatcher({
      onCommit: (value) => {
        delivered.push(value.commit_seq);
      },
      onEnriched: enriched,
    });

    dispatcher.accept(commit(15), "apply");
    await dispatcher.waitForIdle();
    expect(dispatcher.accept(commit(15), "tailer").kind).toBe("duplicate");

    expect(delivered).toEqual([15]);
    expect(enriched).not.toHaveBeenCalled();
  });
});
