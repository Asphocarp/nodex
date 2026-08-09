import { describe, expect, test } from "vitest";

import {
  parseAuthorizedDeliveryPacket,
  type AuthorizedDeliveryPacket,
} from "./authorized-delivery-packet";

const packet = (): AuthorizedDeliveryPacket => ({
  packet_version: 3,
  authorization_scope: {
    kind: "project",
    library_id: "library-1",
    project_id: "project-1",
  },
  manifest: {
    event_version: 7,
    identity: {
      store_epoch: "epoch-1",
      commit_seq: 9,
      manifest_hash: "1".repeat(64),
    },
    operation_id: "operation-1",
    committed_at: "2026-08-09T00:00:00.000Z",
  },
  atoms: [],
  document_effects: [{
    reference: {
      effect_order: 2,
      page_id: "page-1",
      document_id: "document-1",
      generation: 1,
      base_head_seq: 3,
      result_head_seq: 4,
      update_id: "update-1",
      update_hash: "2".repeat(64),
      update_byte_length: 2,
      resource_kind: "document_update",
    },
    inline_update: [4, 5],
  }],
  projection_effects: [],
  revocations: [],
  coverage: {
    atom_ids: [],
    document_effect_orders: [2],
    inline_document_effect_orders: [2],
    projection_scope_keys: [],
  },
  packet_hash: "3".repeat(64),
});

describe("authorized delivery packet boundary", () => {
  test("accepts packet v3 with a complete Document effect", () => {
    const value = packet();
    expect(parseAuthorizedDeliveryPacket(value, {
      eventVersion: 7,
      libraryId: "library-1",
      storeEpoch: "epoch-1",
    })).toBe(value);
  });

  test("rejects legacy packets and coverage that omits a delivered resource", () => {
    expect(() => parseAuthorizedDeliveryPacket({
      ...packet(),
      packet_version: 2,
    })).toThrow("Authorized delivery packet is invalid");
    expect(() => parseAuthorizedDeliveryPacket({
      ...packet(),
      coverage: {
        ...packet().coverage,
        document_effect_orders: [],
      },
    })).toThrow("Authorized delivery packet is invalid");
  });

  test("pins Store, event, and Library authority when the caller supplies them", () => {
    expect(() => parseAuthorizedDeliveryPacket(packet(), {
      eventVersion: 7,
      libraryId: "library-2",
      storeEpoch: "epoch-1",
    })).toThrow("Authorized delivery packet is invalid");
    expect(() => parseAuthorizedDeliveryPacket(packet(), {
      eventVersion: 6,
      libraryId: "library-1",
      storeEpoch: "epoch-1",
    })).toThrow("Authorized delivery packet is invalid");
    expect(() => parseAuthorizedDeliveryPacket(packet(), {
      eventVersion: 7,
      libraryId: "library-1",
      storeEpoch: "epoch-2",
    })).toThrow("Authorized delivery packet is invalid");
  });
});
