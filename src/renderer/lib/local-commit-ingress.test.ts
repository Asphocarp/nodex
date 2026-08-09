import { describe, expect, test, vi } from "vitest";

import type { AuthorizedDeliveryPacket } from "../../shared/local-commit-delivery";
import type { ProjectionStreamMessage } from "../../shared/projection-stream";
import type { ResourceRevocationMessage } from "../../shared/resource-revocation-stream";
import {
  LocalCommitIngressCapacityError,
  RendererLocalCommitIngress,
} from "./local-commit-ingress";

const scope = {
  kind: "project" as const,
  libraryId: "library-1",
  projectId: "project-1",
};

const libraryScope = {
  kind: "library" as const,
  libraryId: "library-1",
};

const effect = (
  revision: number,
  effectHash = String(revision).padStart(64, "a").slice(-64),
): AuthorizedDeliveryPacket["projection_effects"][number] => ({
  scope: {
    schema_version: 1,
    canonical_key: "page:project-1:page-1",
    scope: {
      kind: "page",
      project_id: "project-1",
      page_id: "page-1",
    },
  },
  base_revision: revision - 1,
  result_revision: revision,
  covered_commit_seq: 1,
  patch: {
    kind: "page_changed",
    project_id: "project-1",
    page_id: "page-1",
  },
  requires_read_at_least: false,
  effect_hash: effectHash,
});

const packet = (input: {
  readonly authorization?: AuthorizedDeliveryPacket["authorization_scope"];
  readonly projections?: AuthorizedDeliveryPacket["projection_effects"];
  readonly documents?: AuthorizedDeliveryPacket["document_effects"];
  readonly atoms?: AuthorizedDeliveryPacket["atoms"];
  readonly visibility?: AuthorizedDeliveryPacket["visibility_deltas"];
  readonly packetHash?: string;
} = {}): AuthorizedDeliveryPacket => {
  const projections = input.projections ?? [effect(1)];
  const documents = input.documents ?? [];
  const atoms = input.atoms ?? [];
  const authorization = input.authorization ?? {
    kind: "project" as const,
    library_id: "library-1",
    project_id: "project-1",
  };
  return {
    packet_version: 4,
    delivery_address: authorization,
    authorization_scope: authorization,
    manifest: {
      event_version: 8,
      identity: {
        store_epoch: "epoch-1",
        commit_seq: 1,
        manifest_hash: "1".repeat(64),
      },
      operation_id: "operation-1",
      committed_at: "2026-08-09T00:00:00.000Z",
    },
    atoms,
    document_effects: documents,
    projection_effects: projections,
    visibility_deltas: input.visibility ?? [],
    coverage: {
      atom_ids: atoms.map((atom) => atom.descriptor.atom_id),
      document_effect_orders: documents.map((item) => item.reference.effect_order),
      inline_document_effect_orders: documents
        .filter((item) => item.inline_update !== null && item.inline_update !== undefined)
        .map((item) => item.reference.effect_order),
      projection_scope_keys: projections.map((item) => item.scope.canonical_key),
    },
    packet_hash: input.packetHash ?? "2".repeat(64),
  };
};

const apply = (delivery: AuthorizedDeliveryPacket) => ({
  status: "committed" as const,
  commit: delivery.manifest.identity,
  delivery,
});

describe("RendererLocalCommitIngress", () => {
  test("admits exact revocation before post-state projection callbacks", async () => {
    const ingress = new RendererLocalCommitIngress();
    const order: string[] = [];
    ingress.subscribeRevocation(scope, () => order.push("revoke"));
    ingress.subscribeProjection(scope, () => order.push("projection"));
    const delivery = packet({
      visibility: [{
        authorization_scope: {
          kind: "project",
          library_id: "library-1",
          project_id: "project-1",
        },
        change: { kind: "revoke", reason: "access_revoked" },
        roots: [{ kind: "page", page_id: "page-1" }],
        delta_hash: "9".repeat(64),
      }],
    });

    await ingress.admitPacket(delivery);

    expect(order).toEqual(["revoke", "projection"]);
  });

  test("turns a conservative visibility delta into an address reset", async () => {
    const ingress = new RendererLocalCommitIngress();
    const projections: ProjectionStreamMessage[] = [];
    const revocations: ResourceRevocationMessage[] = [];
    ingress.subscribeProjection(scope, (message) => projections.push(message));
    ingress.subscribeRevocation(scope, (message) => revocations.push(message));

    await ingress.admitPacket(packet({
      visibility: [{
        authorization_scope: {
          kind: "project",
          library_id: "library-1",
          project_id: "project-1",
        },
        change: {
          kind: "conservative_reset",
          reason: "authorization_closure_exceeded",
        },
        roots: [],
        delta_hash: "8".repeat(64),
      }],
    }));

    expect(projections).toEqual([expect.objectContaining({ kind: "reset" })]);
    expect(revocations).toEqual([expect.objectContaining({ kind: "reset" })]);
  });

  test("publishes the origin projection before apply admission resolves", async () => {
    const ingress = new RendererLocalCommitIngress();
    const order: string[] = [];
    ingress.subscribeProjection(scope, () => order.push("projection"));

    await ingress.admitApply(apply(packet())).then(() => order.push("resolved"));

    expect(order).toEqual(["projection", "resolved"]);
  });

  test("deduplicates apply-first and broker-first delivery across packet audiences", async () => {
    const applyFirst = new RendererLocalCommitIngress();
    const applyFirstListener = vi.fn();
    applyFirst.subscribeProjection(scope, applyFirstListener);
    const boundPacket = packet();
    await applyFirst.admitApply(apply(boundPacket));
    await applyFirst.admitPacket(boundPacket);
    expect(applyFirstListener).toHaveBeenCalledTimes(1);

    const brokerFirst = new RendererLocalCommitIngress();
    const brokerFirstListener = vi.fn();
    brokerFirst.subscribeProjection(scope, brokerFirstListener);
    const brokerPacket = packet({
      authorization: { kind: "library", library_id: "library-1" },
      packetHash: "3".repeat(64),
    });
    await brokerFirst.admitPacket(brokerPacket);
    expect(await brokerFirst.admitApply(apply(boundPacket))).toMatchObject({
      kind: "enriched",
    });
    expect(brokerFirstListener).toHaveBeenCalledTimes(1);
  });

  test("delivers one projection effect independently to Library and Project audiences", async () => {
    const ingress = new RendererLocalCommitIngress();
    const libraryListener = vi.fn();
    const projectListener = vi.fn();
    ingress.subscribeProjection(libraryScope, libraryListener);
    ingress.subscribeProjection(scope, projectListener);
    const brokerPacket = packet({
      authorization: { kind: "library", library_id: "library-1" },
      packetHash: "3".repeat(64),
    });
    const projectPacket = packet({ packetHash: "4".repeat(64) });

    await ingress.admitPacket(brokerPacket);
    await ingress.admitPacket(projectPacket);
    await ingress.admitPacket(projectPacket);

    expect(libraryListener).toHaveBeenCalledOnce();
    expect(projectListener).toHaveBeenCalledOnce();
  });

  test("admits new resource coverage as enrichment but rejects hash divergence", async () => {
    const ingress = new RendererLocalCommitIngress();
    const listener = vi.fn();
    ingress.subscribeProjection(scope, listener);
    await ingress.admitPacket(packet());

    const secondEffect = {
      ...effect(1),
      scope: {
        schema_version: 1,
        canonical_key: "page:project-1:page-2",
        scope: {
          kind: "page" as const,
          project_id: "project-1",
          page_id: "page-2",
        },
      },
    };
    expect(await ingress.admitPacket(packet({
      projections: [effect(1), secondEffect],
      packetHash: "4".repeat(64),
    }))).toMatchObject({ kind: "enriched" });
    expect(listener).toHaveBeenCalledTimes(2);

    await expect(ingress.admitPacket(packet({
      projections: [effect(1, "f".repeat(64))],
      packetHash: "5".repeat(64),
    }))).rejects.toThrow("resource identity collision");
  });

  test("keeps semantic atom admission scoped to its authorization audience", async () => {
    const ingress = new RendererLocalCommitIngress();
    const listener = vi.fn();
    ingress.subscribeAtoms(listener);
    const atom: AuthorizedDeliveryPacket["atoms"][number] = {
      descriptor: {
        atom_id: "5".repeat(64),
        atom_order: 0,
        kind: "project_workspace_changed",
        payload_hash: "6".repeat(64),
        required_resources: [{ kind: "library", library_id: "library-1" }],
      },
      payload: {
        module: "project_workspace",
        library_id: "library-1",
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
    };
    const projectA = packet({ projections: [], atoms: [atom] });
    const projectB = packet({
      authorization: {
        kind: "project",
        library_id: "library-1",
        project_id: "project-2",
      },
      projections: [],
      atoms: [atom],
      packetHash: "7".repeat(64),
    });

    expect(await ingress.admitPacket(projectA)).toMatchObject({ kind: "accepted" });
    expect(await ingress.admitPacket(projectB)).toMatchObject({ kind: "enriched" });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  test("rejects a divergent packet atomically without publishing its valid prefix", async () => {
    const ingress = new RendererLocalCommitIngress();
    const listener = vi.fn();
    ingress.subscribeProjection(scope, listener);
    await ingress.admitPacket(packet());
    listener.mockClear();
    const validNewEffect = {
      ...effect(1),
      scope: {
        schema_version: 1,
        canonical_key: "page:project-1:page-2",
        scope: {
          kind: "page" as const,
          project_id: "project-1",
          page_id: "page-2",
        },
      },
    };

    await expect(ingress.admitPacket(packet({
      projections: [validNewEffect, effect(1, "f".repeat(64))],
      packetHash: "7".repeat(64),
    }))).rejects.toThrow("resource identity collision");
    expect(listener).not.toHaveBeenCalled();

    await expect(ingress.admitPacket(packet({
      projections: [validNewEffect],
      packetHash: "8".repeat(64),
    }))).resolves.toMatchObject({ kind: "enriched" });
    expect(listener).toHaveBeenCalledOnce();
  });

  test("coalesces concurrent admission through the remembered resource claims", async () => {
    const ingress = new RendererLocalCommitIngress();
    const listener = vi.fn();
    ingress.subscribeProjection(scope, listener);
    const delivery = packet();

    const results = await Promise.all([
      ingress.admitPacket(delivery),
      ingress.admitPacket(delivery),
    ]);

    expect(results.map((result) => result.kind).sort()).toEqual([
      "accepted",
      "duplicate",
    ]);
    expect(listener).toHaveBeenCalledOnce();
  });

  test("fails closed at admission capacity instead of dropping semantic work", async () => {
    const digest = new Uint8Array(await crypto.subtle.digest(
      "SHA-256",
      Uint8Array.from([1]).buffer,
    ));
    const updateHash = [...digest]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    const document = {
      reference: {
        effect_order: 0,
        page_id: "page-1",
        document_id: "document-1",
        generation: 1,
        base_head_seq: 0,
        result_head_seq: 1,
        update_id: "update-1",
        update_hash: updateHash,
        update_byte_length: 1,
        resource_kind: "document_update" as const,
      },
      inline_update: [1],
    };
    const ingress = new RendererLocalCommitIngress({ maxInFlightAdmissions: 1 });
    const first = ingress.admitPacket(packet({ projections: [], documents: [document] }));
    await expect(ingress.admitPacket(packet({
      projections: [],
      documents: [document],
      packetHash: "6".repeat(64),
    }))).rejects.toBeInstanceOf(LocalCommitIngressCapacityError);
    await first;
  });

  test("isolates downstream listener failures from durable command success", async () => {
    const listenerError = vi.fn();
    const healthy = vi.fn();
    const ingress = new RendererLocalCommitIngress({ onListenerError: listenerError });
    ingress.subscribeProjection(scope, () => {
      throw new Error("consumer failed");
    });
    ingress.subscribeProjection(scope, healthy);

    await expect(ingress.admitApply(apply(packet()))).resolves.toMatchObject({
      kind: "accepted",
    });
    expect(healthy).toHaveBeenCalledOnce();
    expect(listenerError).toHaveBeenCalledOnce();
  });
});
