import { describe, expect, test } from "bun:test";
import {
  ADDITIONAL_DOCUMENT_COMMAND_CAPABILITIES,
  ADDITIONAL_DOCUMENT_COMMAND_VERSION,
  AdditionalDocumentCommandContractError,
  MAX_ADDITIONAL_DOCUMENT_BLOCK_DEPTH,
  MAX_ADDITIONAL_DOCUMENT_BLOCKS,
  MAX_ADDITIONAL_DOCUMENT_CODE_LENGTH,
  additionalDocumentCommandRequiredCoordination,
  canonicalizeAdditionalDocumentCommandIntent,
  encodeAdditionalDocumentCommandSemanticHashInput,
  isAdditionalDocumentSemanticHash,
  parseAdditionalDocumentCommandReceipt,
  parseAdditionalDocumentCommandRequest,
  parseAdditionalDocumentCommandResult,
} from "./additional-document-commands";
import type { BlockTreeNode } from "./block-documents/block-document-codec";

const host = {
  documentId: "document:host",
  generation: 2,
  headSeq: 7,
} as const;

const source = {
  documentId: "document:source",
  generation: 1,
  headSeq: 4,
} as const;

const owner = {
  ownerBlockId: "owner:1",
  metadataRevision: 3,
  locationRevision: 2,
  documentId: "document:owner",
  generation: 1,
  headSeq: 9,
} as const;

const paragraph = (id: string): BlockTreeNode => ({
  id,
  type: "paragraph",
  props: { textAlignment: "left" },
  content: [{ type: "text", text: id, styles: {} }],
  children: [],
});

const fifo = { kind: "fifo_only" } as const;

const ownerHead = {
  documentId: owner.documentId,
  generation: owner.generation,
  headSeq: owner.headSeq,
} as const;

const lease = (
  documents: readonly {
    readonly documentId: string;
    readonly generation: number;
    readonly headSeq: number;
  }[],
  leaseId = "lease:1",
) => ({ kind: "hub_lease" as const, leaseId, documents });

const request = (operation: unknown, coordination: unknown = fifo) => ({
  version: ADDITIONAL_DOCUMENT_COMMAND_VERSION,
  operationId: "operation:1",
  projectId: "project:1",
  storeEpoch: "epoch:1",
  clientSessionId: "session:1",
  actor: { kind: "electron", windowId: 7 },
  coordination,
  operation,
});

const captureError = (operation: () => unknown): unknown => {
  try {
    operation();
    return null;
  } catch (error) {
    return error;
  }
};

const expectContractError = (operation: () => unknown): void => {
  expect(
    captureError(operation) instanceof AdditionalDocumentCommandContractError,
  ).toBeTrue();
};

describe("additional document command contract", () => {
  test("parses every fixed operation shape and derives its write coordination", () => {
    const cases = [
      request({
        kind: "create_synced_source",
        sourceBlockId: "synced:source",
        documentId: "document:synced",
        initialBlocks: [paragraph("synced:root")],
        placement: {
          kind: "space",
          before: { blockId: "top:anchor", expectedLocationRevision: 5 },
        },
      }),
      request(
        {
          kind: "promote_synced_source",
          host,
          rootBlockId: "host:root",
          referenceBlockId: "synced:reference",
          sourceBlockId: "synced:owner",
          sourceDocumentId: "document:synced",
        },
        lease([host]),
      ),
      request(
        {
          kind: "demote_synced_source",
          host,
          source,
          referenceBlockId: "synced:reference",
          sourceBlockId: "synced:owner",
        },
        lease([source, host]),
      ),
      request({
        kind: "create_template",
        sourceBlockId: "template:source",
        documentId: "document:template",
        displayName: "Review template",
        initialBlocks: [paragraph("template:root")],
        placement: { kind: "space" },
      }),
      request(
        {
          kind: "instantiate_template",
          sourceBlockId: "template:source",
          source,
          target: host,
          parentBlockId: "host:parent",
          beforeBlockId: "host:before",
        },
        lease([host, source]),
      ),
      request({
        kind: "create_large_document",
        blockId: "large:document",
        documentId: "document:large",
        displayName: "Long form",
        content: {
          kind: "large_document",
          initialBlocks: [paragraph("large:root")],
        },
        location: { kind: "space" },
      }),
      request(
        {
          kind: "create_large_document",
          blockId: "large:code",
          documentId: "document:code",
          displayName: "Worker",
          content: { kind: "large_code", language: "typescript", code: "" },
          location: { kind: "document", host },
        },
        lease([host]),
      ),
      request(
        {
          kind: "delete_owned_source",
          ownerKind: "reusable_template",
          owner,
          referencePolicy: "require_unreferenced",
        },
        lease([ownerHead]),
      ),
      request({
        kind: "create_canvas_owner",
        scope: "non_primary",
        blockId: "canvas:secondary",
        documentId: "document:canvas:secondary",
        displayName: "Sketch",
        placement: { kind: "space" },
      }),
      request(
        {
          kind: "delete_canvas_owner",
          scope: "non_primary",
          owner,
          referencePolicy: "require_unreferenced",
        },
        lease([ownerHead]),
      ),
    ] as const;

    const kinds = cases.map(
      (candidate) =>
        parseAdditionalDocumentCommandRequest(candidate).operation.kind,
    );
    expect(JSON.stringify(kinds)).toBe(
      JSON.stringify([
        "create_synced_source",
        "promote_synced_source",
        "demote_synced_source",
        "create_template",
        "instantiate_template",
        "create_large_document",
        "create_large_document",
        "delete_owned_source",
        "create_canvas_owner",
        "delete_canvas_owner",
      ]),
    );
    expect(additionalDocumentCommandRequiredCoordination(cases[0])).toBe(
      "fifo_only",
    );
    expect(additionalDocumentCommandRequiredCoordination(cases[1])).toBe(
      "hub_lease",
    );
    expect(additionalDocumentCommandRequiredCoordination(cases[5])).toBe(
      "fifo_only",
    );
    expect(additionalDocumentCommandRequiredCoordination(cases[6])).toBe(
      "hub_lease",
    );
  });

  test("requires the exact logical heads in a renewable Hub lease", () => {
    const operation = {
      kind: "demote_synced_source",
      host,
      source,
      referenceBlockId: "synced:reference",
      sourceBlockId: "synced:source",
    } as const;
    const parsed = parseAdditionalDocumentCommandRequest(
      request(operation, lease([source, host], "lease:first")),
    );
    expect(parsed.coordination.kind).toBe("hub_lease");
    if (parsed.coordination.kind !== "hub_lease") return;
    expect(parsed.coordination.documents[0]?.documentId).toBe("document:host");
    expect(parsed.coordination.documents[1]?.documentId).toBe(
      "document:source",
    );

    expectContractError(() =>
      parseAdditionalDocumentCommandRequest(
        request(operation, lease([{ ...source, headSeq: 3 }, host])),
      ),
    );
    expectContractError(() =>
      parseAdditionalDocumentCommandRequest(request(operation, lease([host]))),
    );
    expectContractError(() =>
      parseAdditionalDocumentCommandRequest(
        request(operation, lease([host, source, source])),
      ),
    );
    expectContractError(() =>
      parseAdditionalDocumentCommandRequest(request(operation, fifo)),
    );
    expectContractError(() =>
      parseAdditionalDocumentCommandRequest(
        request(
          {
            kind: "create_template",
            sourceBlockId: "template:source",
            documentId: "document:template",
            displayName: "Template",
            initialBlocks: [],
            placement: { kind: "space" },
          },
          lease([host]),
        ),
      ),
    );
  });

  test("binds logical revisions and content while excluding audit and lease renewal", () => {
    const operation = {
      kind: "instantiate_template",
      sourceBlockId: "template:source",
      source,
      target: host,
      beforeBlockId: "host:before",
    } as const;
    const first = request(operation, lease([host, source], "lease:first"));
    const retry = {
      ...first,
      actor: { kind: "http_loopback" },
      clientSessionId: "session:after-restart",
      coordination: lease([source, host], "lease:renewed"),
    };
    const firstCanonical = canonicalizeAdditionalDocumentCommandIntent(first);
    expect(canonicalizeAdditionalDocumentCommandIntent(retry)).toBe(
      firstCanonical,
    );
    const receiptReplay = {
      ...retry,
      coordination: { kind: "receipt_replay" },
    } as const;
    expect(canonicalizeAdditionalDocumentCommandIntent(receiptReplay)).toBe(
      firstCanonical,
    );
    expect(
      parseAdditionalDocumentCommandRequest(receiptReplay).coordination.kind,
    ).toBe("receipt_replay");
    expect(
      new TextDecoder().decode(
        encodeAdditionalDocumentCommandSemanticHashInput(first),
      ),
    ).toBe(firstCanonical);

    const changedHead = request(
      { ...operation, target: { ...host, headSeq: host.headSeq + 1 } },
      lease([{ ...host, headSeq: host.headSeq + 1 }, source]),
    );
    expect(
      canonicalizeAdditionalDocumentCommandIntent(changedHead) ===
        firstCanonical,
    ).toBeFalse();
    expect(
      canonicalizeAdditionalDocumentCommandIntent({
        ...first,
        operationId: "operation:other",
      }) === firstCanonical,
    ).toBeFalse();
  });

  test("enforces exact keys, bounded identities, and stable application Block IDs", () => {
    const validOperation = {
      kind: "create_synced_source",
      sourceBlockId: "synced:source",
      documentId: "document:synced",
      initialBlocks: [paragraph("block:1")],
      placement: { kind: "space" },
    } as const;
    expectContractError(() =>
      parseAdditionalDocumentCommandRequest({
        ...request(validOperation),
        surprise: true,
      }),
    );
    expectContractError(() =>
      parseAdditionalDocumentCommandRequest(
        request({ ...validOperation, surprise: true }),
      ),
    );
    expectContractError(() =>
      parseAdditionalDocumentCommandRequest(
        request({
          ...validOperation,
          initialBlocks: [{ ...paragraph("block:1"), surprise: true }],
        }),
      ),
    );
    expectContractError(() =>
      parseAdditionalDocumentCommandRequest(
        request({
          ...validOperation,
          initialBlocks: [paragraph(validOperation.sourceBlockId)],
        }),
      ),
    );
    expectContractError(() =>
      parseAdditionalDocumentCommandRequest(
        request({
          ...validOperation,
          sourceBlockId: "x".repeat(513),
        }),
      ),
    );
    expectContractError(() =>
      parseAdditionalDocumentCommandRequest(
        request({
          ...validOperation,
          initialBlocks: [
            paragraph("block:duplicate"),
            paragraph("block:duplicate"),
          ],
        }),
      ),
    );
    expectContractError(() =>
      parseAdditionalDocumentCommandRequest(
        request({
          ...validOperation,
          placement: {
            kind: "space",
            before: {
              blockId: validOperation.sourceBlockId,
              expectedLocationRevision: 1,
            },
          },
        }),
      ),
    );
    expectContractError(() =>
      parseAdditionalDocumentCommandRequest(
        request({
          ...validOperation,
          initialBlocks: [
            {
              ...paragraph("block:bad-json"),
              props: { invalid: Number.NaN },
            },
          ],
        }),
      ),
    );
  });

  test("bounds content by code length, block count, depth, actor, and total shape", () => {
    expectContractError(() =>
      parseAdditionalDocumentCommandRequest(
        request({
          kind: "create_large_document",
          blockId: "large:code",
          documentId: "document:code",
          displayName: "Code",
          content: {
            kind: "large_code",
            language: "text",
            code: "x".repeat(MAX_ADDITIONAL_DOCUMENT_CODE_LENGTH + 1),
          },
          location: { kind: "space" },
        }),
      ),
    );

    const tooMany = Array.from(
      { length: MAX_ADDITIONAL_DOCUMENT_BLOCKS + 1 },
      (_, index) => paragraph(`block:${index}`),
    );
    expectContractError(() =>
      parseAdditionalDocumentCommandRequest(
        request({
          kind: "create_template",
          sourceBlockId: "template:source",
          documentId: "document:template",
          displayName: "Template",
          initialBlocks: tooMany,
          placement: { kind: "space" },
        }),
      ),
    );

    let nested = paragraph(`block:${MAX_ADDITIONAL_DOCUMENT_BLOCK_DEPTH + 1}`);
    for (
      let depth = MAX_ADDITIONAL_DOCUMENT_BLOCK_DEPTH;
      depth >= 1;
      depth -= 1
    ) {
      nested = { ...paragraph(`block:${depth}`), children: [nested] };
    }
    expectContractError(() =>
      parseAdditionalDocumentCommandRequest(
        request({
          kind: "create_synced_source",
          sourceBlockId: "synced:source",
          documentId: "document:synced",
          initialBlocks: [nested],
          placement: { kind: "space" },
        }),
      ),
    );

    expectContractError(() =>
      parseAdditionalDocumentCommandRequest({
        ...request({
          kind: "create_canvas_owner",
          scope: "non_primary",
          blockId: "canvas:secondary",
          documentId: "document:canvas",
          displayName: "Canvas",
          placement: { kind: "space" },
        }),
        actor: { evidence: "x".repeat(65 * 1024) },
      }),
    );
  });

  test("records copy/move identity rules and exposes unsupported kernels as gaps", () => {
    expect(
      ADDITIONAL_DOCUMENT_COMMAND_CAPABILITIES.promote_synced_source
        .identitySemantics,
    ).toBe("move_preserving_content_ids_create_source_and_reference_ids");
    expect(
      ADDITIONAL_DOCUMENT_COMMAND_CAPABILITIES.demote_synced_source
        .identitySemantics,
    ).toBe("move_preserving_content_ids_delete_source_and_reference_ids");
    expect(
      ADDITIONAL_DOCUMENT_COMMAND_CAPABILITIES.instantiate_template
        .identitySemantics,
    ).toBe("copy_deriving_every_content_id_from_operation_id");
    expect(
      ADDITIONAL_DOCUMENT_COMMAND_CAPABILITIES.delete_owned_source.availability,
    ).toBe("capability_gap");
    expect(
      ADDITIONAL_DOCUMENT_COMMAND_CAPABILITIES.create_canvas_owner.availability,
    ).toBe("capability_gap");
    expect(
      ADDITIONAL_DOCUMENT_COMMAND_CAPABILITIES.delete_canvas_owner.availability,
    ).toBe("capability_gap");
    expect(
      ADDITIONAL_DOCUMENT_COMMAND_CAPABILITIES.create_canvas_owner.gap
        ?.length === 0,
    ).toBeFalse();
  });
});

describe("additional document command result contract", () => {
  const receipt = {
    version: ADDITIONAL_DOCUMENT_COMMAND_VERSION,
    operationId: "operation:1",
    projectId: "project:1",
    storeEpoch: "epoch:1",
    operationKind: "instantiate_template",
    semanticHash: "a".repeat(64),
    duplicate: false,
    effect: {
      createdBlockIds: ["copy:1", "copy:2"],
      preservedBlockIds: ["template:source"],
      deletedBlockIds: [],
      documentHeads: [host, source],
    },
    changeLogSeq: 41,
    committedAt: "2026-07-12T00:00:00.000Z",
  } as const;

  test("parses strict successful receipts for implemented kernels", () => {
    const parsed = parseAdditionalDocumentCommandReceipt(receipt);
    expect(parsed.operationKind).toBe("instantiate_template");
    expect(parsed.effect.documentHeads[0]?.documentId).toBe("document:host");
    expect(parsed.effect.documentHeads[1]?.documentId).toBe("document:source");
    const result = parseAdditionalDocumentCommandResult({
      ok: true,
      value: receipt,
    });
    expect(result.ok).toBeTrue();
    expect(isAdditionalDocumentSemanticHash(receipt.semanticHash)).toBeTrue();
    expect(isAdditionalDocumentSemanticHash("A".repeat(64))).toBeFalse();
  });

  test("does not permit capability gaps to masquerade as committed effects", () => {
    expectContractError(() =>
      parseAdditionalDocumentCommandReceipt({
        ...receipt,
        operationKind: "create_canvas_owner",
      }),
    );
    const gap = parseAdditionalDocumentCommandResult({
      ok: false,
      error: {
        code: "capability_gap",
        message: "Non-primary Canvas creation is not implemented",
        retryable: false,
        operationId: "operation:1",
        operationKind: "create_canvas_owner",
      },
    });
    expect(gap.ok).toBeFalse();
    expectContractError(() =>
      parseAdditionalDocumentCommandResult({
        ok: false,
        error: {
          code: "capability_gap",
          message: "incorrect",
          retryable: true,
          operationId: "operation:1",
          operationKind: "create_canvas_owner",
        },
      }),
    );
    expectContractError(() =>
      parseAdditionalDocumentCommandResult({
        ok: false,
        error: {
          code: "capability_gap",
          message: "incorrect",
          retryable: false,
          operationId: "operation:1",
          operationKind: "create_template",
        },
      }),
    );
  });

  test("rejects malformed hashes, unknown keys, and overlapping effect identities", () => {
    expectContractError(() =>
      parseAdditionalDocumentCommandReceipt({
        ...receipt,
        semanticHash: "A".repeat(64),
      }),
    );
    expectContractError(() =>
      parseAdditionalDocumentCommandReceipt({ ...receipt, surprise: true }),
    );
    expectContractError(() =>
      parseAdditionalDocumentCommandReceipt({
        ...receipt,
        committedAt: "not-a-date",
      }),
    );
    expectContractError(() =>
      parseAdditionalDocumentCommandReceipt({
        ...receipt,
        effect: {
          ...receipt.effect,
          deletedBlockIds: ["copy:1"],
        },
      }),
    );
  });
});
