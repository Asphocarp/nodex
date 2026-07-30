import { describe, expect, test } from "vitest";
import {
  ADDITIONAL_DOCUMENT_COMMAND_CAPABILITIES,
  ADDITIONAL_DOCUMENT_COMMAND_VERSION,
  AdditionalDocumentCommandContractError,
  AdditionalDocumentExecutionProofError,
  MAX_ADDITIONAL_DOCUMENT_BLOCK_DEPTH,
  MAX_ADDITIONAL_DOCUMENT_BLOCKS,
  additionalDocumentCommandRequiredCoordination,
  canonicalizeAdditionalDocumentCommandIntent,
  compileAdditionalDocumentCommandExecution,
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
} as const;

const hostHead = { ...host, headSeq: 7 } as const;

const source = {
  documentId: "document:source",
  generation: 1,
} as const;

const sourceHead = { ...source, headSeq: 4 } as const;

const owner = {
  ownerBlockId: "owner:1",
  metadataRevision: 3,
  locationRevision: 2,
  documentId: "document:owner",
  generation: 1,
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
  headSeq: 9,
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
  ).toBe(true);
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
        lease([hostHead]),
      ),
      request(
        {
          kind: "demote_synced_source",
          host,
          source,
          referenceBlockId: "synced:reference",
          sourceBlockId: "synced:owner",
        },
        lease([sourceHead, hostHead]),
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
        lease([hostHead, sourceHead]),
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
        "delete_owned_source",
      ]),
    );
    expect(additionalDocumentCommandRequiredCoordination(cases[0])).toBe(
      "fifo_only",
    );
    expect(additionalDocumentCommandRequiredCoordination(cases[1])).toBe(
      "hub_lease",
    );
    expect(additionalDocumentCommandRequiredCoordination(cases[5])).toBe(
      "hub_lease",
    );
  });

  test("requires exact logical Documents while allowing renewable Hub heads", () => {
    const operation = {
      kind: "demote_synced_source",
      host,
      source,
      referenceBlockId: "synced:reference",
      sourceBlockId: "synced:source",
    } as const;
    const parsed = parseAdditionalDocumentCommandRequest(
      request(operation, lease([sourceHead, hostHead], "lease:first")),
    );
    expect(parsed.coordination.kind).toBe("hub_lease");
    if (parsed.coordination.kind !== "hub_lease") return;
    expect(parsed.coordination.documents[0]?.documentId).toBe("document:host");
    expect(parsed.coordination.documents[1]?.documentId).toBe(
      "document:source",
    );

    expectContractError(() =>
      parseAdditionalDocumentCommandRequest(
        request(operation, lease([{ ...sourceHead, generation: 2 }, hostHead])),
      ),
    );
    expectContractError(() =>
      parseAdditionalDocumentCommandRequest(
        request(operation, lease([hostHead])),
      ),
    );
    expectContractError(() =>
      parseAdditionalDocumentCommandRequest(
        request(operation, lease([hostHead, sourceHead, sourceHead])),
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
          lease([hostHead]),
        ),
      ),
    );
  });

  test("binds logical revisions and anchors while excluding audit and execution heads", () => {
    const operation = {
      kind: "instantiate_template",
      sourceBlockId: "template:source",
      source,
      target: host,
      beforeBlockId: "host:before",
    } as const;
    const first = request(
      operation,
      lease([hostHead, sourceHead], "lease:first"),
    );
    const retry = {
      ...first,
      actor: { kind: "http_loopback" },
      clientSessionId: "session:after-restart",
      coordination: lease([sourceHead, hostHead], "lease:renewed"),
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

    const changedHead = compileAdditionalDocumentCommandExecution(first, {
      leaseId: "lease:after-flush",
      documents: [
        { ...hostHead, headSeq: hostHead.headSeq + 1 },
        { ...sourceHead, headSeq: sourceHead.headSeq + 2 },
      ],
    });
    expect(canonicalizeAdditionalDocumentCommandIntent(changedHead)).toBe(
      firstCanonical,
    );
    expect(changedHead.coordination.documents[0]?.headSeq).toBe(8);
    const generationChange = captureError(() =>
      compileAdditionalDocumentCommandExecution(first, {
        leaseId: "lease:generation-changed",
        documents: [
          { ...hostHead, generation: hostHead.generation + 1 },
          sourceHead,
        ],
      }),
    );
    expect(
      generationChange instanceof AdditionalDocumentExecutionProofError,
    ).toBe(true);
    if (generationChange instanceof AdditionalDocumentExecutionProofError) {
      expect(generationChange.code).toBe("document_generation_mismatch");
    }
    const changedAnchor = request(
      { ...operation, beforeBlockId: "host:other-before" },
      lease([hostHead, sourceHead], "lease:other-anchor"),
    );
    expect(
      canonicalizeAdditionalDocumentCommandIntent(changedAnchor) ===
        firstCanonical,
    ).toBe(false);
    expect(
      canonicalizeAdditionalDocumentCommandIntent({
        ...first,
        operationId: "operation:other",
      }) === firstCanonical,
    ).toBe(false);
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

  test("bounds content by block count, depth, actor, and total shape", () => {
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
          kind: "create_synced_source",
          sourceBlockId: "synced:source",
          documentId: "document:synced",
          initialBlocks: [paragraph("synced:root")],
          placement: { kind: "space" },
        }),
        actor: { evidence: "x".repeat(65 * 1024) },
      }),
    );
  });

  test("records identity rules and exposes every owned-Document lifecycle kernel", () => {
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
    ).toBe("kernel_ready");
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
      documentHeads: [hostHead, sourceHead],
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
    expect(result.ok).toBe(true);
    expect(isAdditionalDocumentSemanticHash(receipt.semanticHash)).toBe(true);
    expect(isAdditionalDocumentSemanticHash("A".repeat(64))).toBe(false);
  });

  test("rejects retired Canvas-owner receipts and stale capability-gap claims", () => {
    expectContractError(() =>
      parseAdditionalDocumentCommandReceipt({
        ...receipt,
        operationKind: "create_canvas_owner",
      }),
    );
    expectContractError(() =>
      parseAdditionalDocumentCommandResult({
        ok: false,
        error: {
          code: "capability_gap",
          message: "stale gap",
          retryable: false,
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
