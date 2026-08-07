import { describe, expect, test, vi } from "vitest";

import type { CoreAuthorizedDeliveryPacket } from "./types";
import { LocalCommitCoordinator } from "./local-commit-coordinator";
import { createCoreLocalCommitFixture } from "./testing/local-commit-fixture";

const projectionEffect = (
  revision: number,
  scopeKey = "scope-view-1",
  coveredCommitSeq = revision,
): CoreAuthorizedDeliveryPacket["projection_effects"][number] => ({
  scope: {
    schema_version: 1,
    canonical_key: scopeKey,
    scope: {
      kind: "database_view",
      project_id: "project-1",
      database_id: "database-1",
      data_source_id: "source-1",
      view_id: "view-1",
    },
  },
  base_revision: revision - 1,
  result_revision: revision,
  covered_commit_seq: coveredCommitSeq,
  patch: null,
  requires_read_at_least: true,
  effect_hash: String(revision).padStart(64, "a").slice(-64),
});

const documentEffect = (
  documentId: string,
  baseHeadSeq: number,
  resultHeadSeq: number,
  effectOrder: number,
): CoreAuthorizedDeliveryPacket["document_effects"][number] => ({
  reference: {
    base_head_seq: baseHeadSeq,
    document_id: documentId,
    effect_order: effectOrder,
    generation: 1,
    page_id: null,
    resource_kind: "document_update",
    result_head_seq: resultHeadSeq,
    update_byte_length: 1,
    update_hash: String(resultHeadSeq).padStart(64, "b").slice(-64),
    update_id: `update:${documentId}:${resultHeadSeq}`,
  },
  inline_update: null,
});

const commit = (
  commitSeq: number,
  options: {
    readonly manifestHash?: string;
    readonly documentEffects?: CoreAuthorizedDeliveryPacket["document_effects"];
    readonly projectionEffects?: CoreAuthorizedDeliveryPacket["projection_effects"];
  } = {},
): CoreAuthorizedDeliveryPacket => createCoreLocalCommitFixture({
  commitSeq,
  canonicalHash: options.manifestHash
    ?? String(commitSeq).padStart(64, "0"),
  documentEffects: options.documentEffects,
  projectionEffects: options.projectionEffects,
  payload: {
    module: "project_workspace",
    event: {
      kind: "workspace_changed",
      project_catalog_change: null,
      project_ids: [],
      session_ids: [],
      thread_ids: [],
      session_summary_scopes: [],
      session_detail_ids: [],
    },
  },
});

const flush = async (): Promise<void> => {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
};

describe("LocalCommitCoordinator", () => {
  test("admits the apply response synchronously without awaiting any lane", () => {
    const projection = vi.fn();
    const coordinator = new LocalCommitCoordinator({
      expectedStoreEpoch: "epoch-1",
      onDocument: vi.fn(),
      onProjection: projection,
      onNotification: vi.fn(),
    });

    expect(coordinator.admit(commit(1, {
      projectionEffects: [projectionEffect(1)],
    }), "apply").kind).toBe("accepted");
    expect(projection).not.toHaveBeenCalled();
    expect(coordinator.diagnostics().pendingDeliveries).toBe(2);
  });

  test("does not let a blocked projection scope delay notifications or another scope", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const delivered: string[] = [];
    const coordinator = new LocalCommitCoordinator({
      expectedStoreEpoch: "epoch-1",
      onDocument: vi.fn(),
      onProjection: async (_packet, effect) => {
        delivered.push(effect.scope.canonical_key);
        if (effect.scope.canonical_key === "scope-blocked") await gate;
      },
      onNotification: (packet) => {
        delivered.push(`notification:${packet.manifest.identity.commit_seq}`);
      },
    });

    coordinator.admit(commit(1, {
      projectionEffects: [projectionEffect(1, "scope-blocked")],
    }), "apply");
    coordinator.admit(commit(2, {
      projectionEffects: [projectionEffect(2, "scope-free")],
    }), "tailer");
    await flush();

    expect(delivered).toEqual(expect.arrayContaining([
      "scope-blocked",
      "scope-free",
      "notification:1",
      "notification:2",
    ]));
    release();
    await flush();
  });

  test("serializes overlapping Document sets without cross-Document blocking", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const delivered: string[] = [];
    const coordinator = new LocalCommitCoordinator({
      expectedStoreEpoch: "epoch-1",
      onDocument: async (packet, documentId) => {
        const coordinate = `${documentId}:${packet.manifest.identity.commit_seq}`;
        delivered.push(coordinate);
        if (coordinate === "document:one:1") await gate;
      },
      onProjection: vi.fn(),
      onNotification: vi.fn(),
    });
    coordinator.admit(commit(1, {
      documentEffects: [
        documentEffect("document:one", 0, 1, 0),
        documentEffect("document:two", 0, 1, 1),
      ],
    }), "apply");
    coordinator.admit(commit(2, {
      documentEffects: [documentEffect("document:one", 1, 2, 0)],
    }), "tailer");
    await flush();

    expect(delivered).toEqual([
      "document:one:1",
      "document:two:1",
    ]);
    release();
    await flush();
    expect(delivered).toEqual([
      "document:one:1",
      "document:two:1",
      "document:one:2",
    ]);
  });

  test("serializes one scope while preserving received revision order", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const delivered: number[] = [];
    const coordinator = new LocalCommitCoordinator({
      expectedStoreEpoch: "epoch-1",
      onDocument: vi.fn(),
      onProjection: async (_packet, effect) => {
        delivered.push(effect.result_revision);
        if (effect.result_revision === 2) await gate;
      },
      onNotification: vi.fn(),
    });
    coordinator.admit(commit(2, {
      projectionEffects: [projectionEffect(2)],
    }), "apply");
    coordinator.admit(commit(1, {
      projectionEffects: [projectionEffect(1)],
    }), "tailer");
    await flush();
    expect(delivered).toEqual([2]);
    release();
    await flush();
    expect(delivered).toEqual([2, 1]);
  });

  test("deduplicates apply/tailer coverage and admits later enrichment", async () => {
    const projection = vi.fn();
    const notification = vi.fn();
    const coordinator = new LocalCommitCoordinator({
      expectedStoreEpoch: "epoch-1",
      onDocument: vi.fn(),
      onProjection: projection,
      onNotification: notification,
    });
    const sparse = commit(3);
    const rich = commit(3, { projectionEffects: [projectionEffect(1, "scope-view-1", 3)] });

    expect(coordinator.admit(sparse, "apply").kind).toBe("accepted");
    expect(coordinator.admit(sparse, "tailer").kind).toBe("duplicate");
    expect(coordinator.admit(rich, "tailer").kind).toBe("enriched");
    await flush();

    expect(notification).toHaveBeenCalledOnce();
    expect(projection).toHaveBeenCalledOnce();
  });

  test("recovers a lost apply response from the tailer before absorbing the late apply", async () => {
    const projection = vi.fn();
    const notification = vi.fn();
    const coordinator = new LocalCommitCoordinator({
      expectedStoreEpoch: "epoch-1",
      onDocument: vi.fn(),
      onProjection: projection,
      onNotification: notification,
    });
    const packet = commit(5, {
      projectionEffects: [projectionEffect(1, "scope-view-1", 5)],
    });

    expect(coordinator.admit(packet, "tailer").kind).toBe("accepted");
    expect(coordinator.admit(packet, "apply").kind).toBe("duplicate");
    await flush();

    expect(notification).toHaveBeenCalledOnce();
    expect(projection).toHaveBeenCalledOnce();
  });

  test("releases a failed resource claim so durable replay can recover it", async () => {
    const projection = vi.fn()
      .mockRejectedValueOnce(new Error("one"))
      .mockRejectedValueOnce(new Error("two"))
      .mockRejectedValueOnce(new Error("three"))
      .mockResolvedValue(undefined);
    const onError = vi.fn();
    const coordinator = new LocalCommitCoordinator({
      expectedStoreEpoch: "epoch-1",
      onDocument: vi.fn(),
      onProjection: projection,
      onNotification: vi.fn(),
      onError,
    });
    const packet = commit(6, {
      projectionEffects: [projectionEffect(1, "scope-retry", 6)],
    });

    expect(coordinator.admit(packet, "apply").kind).toBe("accepted");
    await flush();
    expect(onError).toHaveBeenCalledOnce();

    expect(coordinator.admit(packet, "replay").kind).toBe("enriched");
    await flush();
    expect(projection).toHaveBeenCalledTimes(4);
  });

  test("rejects manifest and resource collisions at admission", () => {
    const coordinator = new LocalCommitCoordinator({
      expectedStoreEpoch: "epoch-1",
      onDocument: vi.fn(),
      onProjection: vi.fn(),
      onNotification: vi.fn(),
    });
    coordinator.admit(commit(4, {
      projectionEffects: [projectionEffect(1, "scope-view-1", 4)],
    }), "apply");
    expect(() => coordinator.admit(commit(4, {
      manifestHash: "f".repeat(64),
    }), "tailer")).toThrow("manifest identity collision");
    expect(() => coordinator.admit(commit(4, {
      projectionEffects: [{
        ...projectionEffect(1, "scope-view-1", 4),
        effect_hash: "e".repeat(64),
      }],
    }), "tailer")).toThrow("resource identity collision");
  });

  test("bounds remembered identities and records durable checkpoints", () => {
    const coordinator = new LocalCommitCoordinator({
      expectedStoreEpoch: "epoch-1",
      maxRememberedCommits: 2,
      onDocument: vi.fn(),
      onProjection: vi.fn(),
      onNotification: vi.fn(),
    });
    coordinator.admit(commit(1), "tailer");
    coordinator.admit(commit(2), "tailer");
    coordinator.admit(commit(3), "tailer");
    coordinator.observeCheckpoint({
      store_epoch: "epoch-1",
      generation: "generation-1",
      scanned_through_seq: 3,
      oldest_available_seq: 1,
      resync_token: null,
    });

    expect(coordinator.diagnostics()).toMatchObject({
      rememberedCommits: 2,
      checkpoint: { scanned_through_seq: 3 },
    });
  });
});
