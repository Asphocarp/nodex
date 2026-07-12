import { describe, expect, test } from "vitest";
import {
  allocateBlockOwnershipCopyIdentities,
  planBlockOwnershipClosure,
  type BlockOwnershipGraphReader,
  type OwnershipClosureBlock,
  type OwnershipClosureDocument,
} from "./block-ownership-copy-plan";

const blocks = new Map<string, OwnershipClosureBlock>([
  ["card-a", { blockId: "card-a", blockType: "card", containingDocumentId: null }],
  ["paragraph-a", { blockId: "paragraph-a", blockType: "paragraph", containingDocumentId: "document-a" }],
  ["card-b", { blockId: "card-b", blockType: "card", containingDocumentId: "document-a" }],
  ["card-ref", { blockId: "card-ref", blockType: "cardRef", containingDocumentId: "document-a" }],
  ["paragraph-b", { blockId: "paragraph-b", blockType: "paragraph", containingDocumentId: "document-b" }],
  ["large-document", { blockId: "large-document", blockType: "largeDocument", containingDocumentId: "document-b" }],
  ["paragraph-large", { blockId: "paragraph-large", blockType: "paragraph", containingDocumentId: "document-large" }],
  ["external-target", { blockId: "external-target", blockType: "card", containingDocumentId: null }],
]);

const documents = new Map<string, OwnershipClosureDocument>([
  ["card-a", { documentId: "document-a", ownerBlockId: "card-a", schemaKey: "nodex.card", schemaVersion: 1 }],
  ["card-b", { documentId: "document-b", ownerBlockId: "card-b", schemaKey: "nodex.card", schemaVersion: 1 }],
  ["large-document", { documentId: "document-large", ownerBlockId: "large-document", schemaKey: "nodex.large-document", schemaVersion: 1 }],
  ["external-target", { documentId: "document-external", ownerBlockId: "external-target", schemaKey: "nodex.card", schemaVersion: 1 }],
]);

const reader: BlockOwnershipGraphReader = {
  readBlock: (blockId) => blocks.get(blockId) ?? null,
  readOwnedDocument: (ownerBlockId) => documents.get(ownerBlockId) ?? null,
  readDocumentBlocks: (documentId) =>
    [...blocks.values()].filter(
      (block) => block.containingDocumentId === documentId,
    ),
};

describe("Block ownership copy plan", () => {
  test("follows nested owned Documents but never reference targets", () => {
    const closure = planBlockOwnershipClosure(reader, ["card-a"]);
    expect(closure.blocks.map((block) => block.blockId)).toEqual([
      "card-a",
      "paragraph-a",
      "card-b",
      "paragraph-b",
      "large-document",
      "paragraph-large",
      "card-ref",
    ]);
    expect(closure.documents.map((document) => document.documentId)).toEqual([
      "document-a",
      "document-b",
      "document-large",
    ]);
    expect(closure.blocks.some((block) => block.blockId === "external-target")).toBe(
      false,
    );
  });

  test("allocates stable, role-separated fresh identities", () => {
    const closure = planBlockOwnershipClosure(reader, ["card-a"]);
    const first = allocateBlockOwnershipCopyIdentities("copy-operation", closure);
    const retry = allocateBlockOwnershipCopyIdentities("copy-operation", closure);
    expect(retry).toEqual(first);
    expect(new Set(Object.values(first.blockIds)).size).toBe(
      closure.blocks.length,
    );
    expect(new Set(Object.values(first.documentIds)).size).toBe(
      closure.documents.length,
    );
    expect(first.blockIds["card-a"]).not.toBe(first.documentIds["document-a"]);
  });
});
