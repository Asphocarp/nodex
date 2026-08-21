import { describe, expect, test } from "vitest";
import * as Y from "yjs";
import { createPageDocumentGenesis, materializePageDocument } from "./block-document-codec";
import { isLegacyForeignBodyReference } from "./derived-records";
import {
  ForeignReferenceMigrationError,
  migrateForeignReferences,
} from "./foreign-reference-migration";

const legacyDocument = () => {
  let sequence = 0;
  return createPageDocumentGenesis({
    documentId: "document:legacy-reference-host",
    title: "Host",
    nfm: [
      '<card-ref project="project-a" card="card-a" />',
      '<card-toggle card="missing-card" meta="[P1]" project="project-a">',
      "\tRecovered title",
      "\tRecovered body",
      '\t<card-ref project="project-z" card="nested-snapshot-card" />',
      "</card-toggle>",
      '<toggle-list-inline-view project="project-b" rules-v2="eyJtb2RlIjoiYWxsIn0" property-order="priority,estimate,status,tags" show-empty-estimate="false" show-empty-priority="false" />',
    ].join("\n"),
    allocateBlockId: () => `block-${sequence++}`,
  });
};

describe("foreign reference Document migration", () => {
  test("keeps decode-canonical Page references and migrates remaining legacy projections", () => {
    const source = legacyDocument();
    const before = materializePageDocument(source.document);
    const pageReferenceId = before.blockTree[0]?.id ?? "";
    const cardToggleId = before.blockTree[1]?.id ?? "";
    const queryId = before.blockTree[2]?.id ?? "";
    const removedToggleChildIds = before.blockTree[1]?.children.map((block) => block.id) ?? [];

    const migration = migrateForeignReferences(source.document, [
      {
        kind: "page",
        sourceBlockId: cardToggleId,
        targetBlockId: "recovered-card",
      },
      {
        kind: "database_view",
        sourceBlockId: queryId,
        databaseViewId: `database-view:inline:${queryId}`,
        displayHint: "Project B",
      },
    ]);

    expect(materializePageDocument(source.document).nfm).toBe(before.nfm);
    expect(migration.materialization.references.some(isLegacyForeignBodyReference)).toBe(false);
    expect(migration.migratedBlockIds.join(",")).toBe([cardToggleId, queryId].join(","));
    expect(migration.removedDescendantBlockIds.join(",")).toBe(removedToggleChildIds.join(","));
    expect(migration.materialization.blockTree[0]?.id).toBe(pageReferenceId);
    expect(migration.materialization.blockTree[1]?.id).toBe(cardToggleId);
    expect(migration.materialization.blockTree[1]?.children.length).toBe(0);
    expect(migration.materialization.blockTree[2]?.id).toBe(queryId);
    expect(migration.materialization.nfm).toBe(
      [
        '<page-ref url="nodex://pages/card-a" />',
        '<page-ref url="nodex://pages/recovered-card" />',
        `<database-view-ref database-view="database-view:inline:${queryId}" display-hint="Project B" />`,
      ].join("\n"),
    );

    const replay = new Y.Doc({ guid: source.document.guid });
    Y.applyUpdate(replay, Y.encodeStateAsUpdate(source.document));
    Y.applyUpdate(replay, migration.update);
    expect(materializePageDocument(replay).nfm).toBe(migration.materialization.nfm);
    replay.destroy();
    source.document.destroy();
  });

  test("fails without mutating the source when a resolution is missing or has the wrong kind", () => {
    const source = legacyDocument();
    const before = Y.encodeStateAsUpdate(source.document);
    const references = materializePageDocument(source.document).references.filter(
      isLegacyForeignBodyReference,
    );
    let error: unknown;
    try {
      migrateForeignReferences(source.document, [
        {
          kind: "database_view",
          sourceBlockId: references[0]?.sourceBlockId ?? "",
          databaseViewId: "database-view:wrong-kind",
        },
      ]);
    } catch (caught) {
      error = caught;
    }
    expect(error instanceof ForeignReferenceMigrationError).toBe(true);
    expect(Buffer.from(Y.encodeStateAsUpdate(source.document)).equals(Buffer.from(before))).toBe(
      true,
    );
    source.document.destroy();
  });
});
