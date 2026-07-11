import { describe, expect, test } from "bun:test";
import * as Y from "yjs";
import {
  createCardDocumentGenesis,
  materializeCardDocument,
} from "./block-document-codec";
import {
  LegacyNfmShadowTranslationError,
  translateLegacyNfmIntoCardDocument,
} from "./legacy-nfm-shadow-translator";

const flatten = (
  blocks: readonly {
    readonly id: string;
    readonly type: string;
    readonly children: readonly unknown[];
  }[],
): readonly { readonly id: string; readonly type: string }[] =>
  blocks.flatMap((block) => [
    { id: block.id, type: block.type },
    ...flatten(
      block.children as readonly {
        readonly id: string;
        readonly type: string;
        readonly children: readonly unknown[];
      }[],
    ),
  ]);

const encodedState = (document: Y.Doc): string =>
  Array.from(Y.encodeStateAsUpdate(document)).join(",");

describe("LegacyNfmShadowTranslator", () => {
  test("preserves IDs across text, property, and custom Block edits", () => {
    let nextId = 0;
    const genesis = createCardDocumentGenesis({
      documentId: "legacy-shadow-edits",
      title: "Before",
      nfm: [
        "First paragraph",
        "- [ ] Original task",
        '<image source="nodex://assets/before.png">Caption</image>',
        '<card-ref project="project-a" card="card-before" />',
      ].join("\n"),
      allocateBlockId: () => `existing-${++nextId}`,
    });
    const before = flatten(genesis.materialization.blockTree);

    const result = translateLegacyNfmIntoCardDocument({
      document: genesis.document,
      authority: "legacy_shadow",
      readiness: "ready",
      title: "After",
      nfm: [
        "First paragraph revised",
        "- [x] Original task",
        '<image source="nodex://assets/after.png">Caption</image>',
        '<card-ref project="project-a" card="card-after" />',
      ].join("\n"),
      allocateBlockId: () => `new-${++nextId}`,
    });

    expect(result.changed).toBeTrue();
    expect(result.update.byteLength > 0).toBeTrue();
    expect(result.materialization.title).toBe("After");
    expect(
      flatten(result.materialization.blockTree)
        .map((block) => block.id)
        .join(","),
    ).toBe(before.map((block) => block.id).join(","));
  });

  test("preserves moved and nested IDs while allocating only inserted Blocks", () => {
    let nextId = 0;
    const genesis = createCardDocumentGenesis({
      documentId: "legacy-shadow-structure",
      title: "Structure",
      nfm: "Alpha\nBeta\nGamma",
      allocateBlockId: () => `stable-${++nextId}`,
    });
    const [alpha, beta, gamma] = flatten(genesis.materialization.blockTree);
    let allocationCount = 0;

    const result = translateLegacyNfmIntoCardDocument({
      document: genesis.document,
      authority: "legacy_shadow",
      readiness: "ready",
      title: "Structure",
      nfm: "Gamma\n\tAlpha\n- Inserted",
      allocateBlockId: () => `inserted-${++allocationCount}`,
    });
    const [movedGamma, nestedAlpha, inserted] = flatten(
      result.materialization.blockTree,
    );

    expect(movedGamma?.id).toBe(gamma?.id);
    expect(nestedAlpha?.id).toBe(alpha?.id);
    expect(inserted?.id).toBe("inserted-1");
    expect(
      flatten(result.materialization.blockTree).some(
        (block) => block.id === beta?.id,
      ),
    ).toBeFalse();
    expect(allocationCount).toBe(1);
  });

  test("aligns an edited Block after a leading insertion", () => {
    let nextId = 0;
    const genesis = createCardDocumentGenesis({
      documentId: "legacy-shadow-sequence",
      title: "Sequence",
      nfm: "First sentence\nSecond sentence",
      allocateBlockId: () => `sequence-${++nextId}`,
    });
    const [first, second] = flatten(genesis.materialization.blockTree);
    let allocationCount = 0;

    const result = translateLegacyNfmIntoCardDocument({
      document: genesis.document,
      authority: "legacy_shadow",
      readiness: "ready",
      title: "Sequence",
      nfm: "Inserted introduction\nFirst sentence revised\nSecond sentence",
      allocateBlockId: () => `sequence-new-${++allocationCount}`,
    });
    const [inserted, editedFirst, unchangedSecond] = flatten(
      result.materialization.blockTree,
    );

    expect(inserted?.id).toBe("sequence-new-1");
    expect(editedFirst?.id).toBe(first?.id);
    expect(unchangedSecond?.id).toBe(second?.id);
    expect(allocationCount).toBe(1);
  });

  test("replays the relative update on replicas and ignores duplicate delivery", () => {
    const genesis = createCardDocumentGenesis({
      documentId: "legacy-shadow-replay",
      title: "Replay before",
      nfm: "Parent\n\tChild",
      allocateBlockId: (() => {
        let index = 0;
        return () => `replay-${++index}`;
      })(),
    });
    const sourceBefore = encodedState(genesis.document);
    const replica = new Y.Doc({ guid: genesis.document.guid });
    Y.applyUpdate(replica, genesis.update);

    const result = translateLegacyNfmIntoCardDocument({
      document: genesis.document,
      authority: "legacy_shadow",
      readiness: "ready",
      title: "Replay after",
      nfm: "Parent updated\n\tChild\nSibling",
      allocateBlockId: () => "replay-new",
    });

    expect(encodedState(genesis.document)).toBe(sourceBefore);
    Y.applyUpdate(replica, result.update);
    expect(materializeCardDocument(replica).title).toBe("Replay after");
    expect(materializeCardDocument(replica).nfm).toBe(
      result.materialization.nfm,
    );
    const vectorAfterFirstApply = Array.from(Y.encodeStateVector(replica)).join(
      ",",
    );
    Y.applyUpdate(replica, result.update);
    expect(Array.from(Y.encodeStateVector(replica)).join(",")).toBe(
      vectorAfterFirstApply,
    );

    const repeated = translateLegacyNfmIntoCardDocument({
      document: replica,
      authority: "legacy_shadow",
      readiness: "ready",
      title: "Replay after",
      nfm: "Parent updated\n\tChild\nSibling",
      allocateBlockId: () => "must-not-be-allocated",
    });
    expect(repeated.changed).toBeFalse();
    expect(repeated.update.byteLength).toBe(0);
  });

  test("returns a true empty update for a normalized no-op", () => {
    const genesis = createCardDocumentGenesis({
      documentId: "legacy-shadow-noop",
      title: "No-op",
      nfm: "Same body",
      allocateBlockId: () => "same-id",
    });
    let allocations = 0;

    const result = translateLegacyNfmIntoCardDocument({
      document: genesis.document,
      authority: "legacy_shadow",
      readiness: "ready",
      title: "No-op",
      nfm: "Same body\n",
      allocateBlockId: () => {
        allocations += 1;
        return `unexpected-${allocations}`;
      },
    });

    expect(result.changed).toBeFalse();
    expect(result.update.byteLength).toBe(0);
    expect(allocations).toBe(0);
  });

  test("rejects the wrong authority/readiness and leaves the source unchanged", () => {
    const genesis = createCardDocumentGenesis({
      documentId: "legacy-shadow-guards",
      title: "Guarded",
      nfm: "Existing",
      allocateBlockId: () => "existing-id",
    });
    const before = encodedState(genesis.document);
    let authorityError = false;
    let readinessError = false;

    try {
      translateLegacyNfmIntoCardDocument({
        document: genesis.document,
        authority: "ydoc_primary",
        readiness: "ready",
        title: "Rejected",
        nfm: "Rejected",
      });
    } catch (error) {
      authorityError = error instanceof LegacyNfmShadowTranslationError;
    }
    try {
      translateLegacyNfmIntoCardDocument({
        document: genesis.document,
        authority: "legacy_shadow",
        readiness: "pending_genesis",
        title: "Rejected",
        nfm: "Rejected",
      });
    } catch (error) {
      readinessError = error instanceof LegacyNfmShadowTranslationError;
    }

    expect(authorityError).toBeTrue();
    expect(readinessError).toBeTrue();
    expect(encodedState(genesis.document)).toBe(before);
  });

  test("validates a candidate before mutation and remains pure on allocation failure", () => {
    const genesis = createCardDocumentGenesis({
      documentId: "legacy-shadow-failure-purity",
      title: "Pure",
      nfm: "Existing",
      allocateBlockId: () => "existing-id",
    });
    const before = encodedState(genesis.document);
    let error: unknown;

    try {
      translateLegacyNfmIntoCardDocument({
        document: genesis.document,
        authority: "legacy_shadow",
        readiness: "ready",
        title: "Pure",
        nfm: "Existing\nNew one\nNew two",
        allocateBlockId: () => "duplicate-new-id",
      });
    } catch (caught) {
      error = caught;
    }

    expect(error instanceof LegacyNfmShadowTranslationError).toBeTrue();
    expect(encodedState(genesis.document)).toBe(before);
    expect(materializeCardDocument(genesis.document).nfm).toBe("Existing");
  });
});
