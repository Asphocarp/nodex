import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as Y from "yjs";
import {
  ADDITIONAL_DOCUMENT_BEARING_OPERATION_VERSION,
  LARGE_CODE_BLOCK_TYPE,
  LARGE_DOCUMENT_BLOCK_TYPE,
  REUSABLE_TEMPLATE_REFERENCE_TYPE,
  type RelocateBlocks,
} from "../src/shared/block-documents";
import {
  createDetachedCardDocumentFromBlockTree,
  type BlockTreeNode,
} from "../src/shared/block-documents/block-document-codec";
import { DOCUMENT_VERSION_CONTRACT_VERSION } from "../src/shared/block-documents/document-history";
import { inspectOwnedBlockDocument } from "../src/shared/block-documents/document-schema-adapters";
import {
  AdditionalDocumentBearingBlockError,
  assertReusableTemplateSourceIsUnreferenced,
  createExplicitDocumentBearingBlock,
  createReusableTemplateReference,
  createReusableTemplateSource,
  getDocumentBearingBlockSummary,
  instantiateReusableTemplate,
} from "../src/main/local-store/additional-document-bearing-blocks";
import {
  applyBlockDocumentUpdate,
  initializeBlockDocumentGenesis,
  loadPrimaryBlockDocument,
} from "../src/main/local-store/block-document-store";
import { relocateBlocksAtomically } from "../src/main/local-store/block-relocations";
import {
  closeDatabase,
  getDb,
  initializeDatabase,
} from "../src/main/local-store/database";
import { createDocumentVersionCheckpoint } from "../src/main/local-store/document-versions";
import { createProject } from "../src/main/local-store/projects";
import { createUuidV7FromTimestamp, isUuidV7 } from "../src/shared/card-id";

const invariant: (condition: unknown, message: string) => asserts condition = (
  condition,
  message,
) => {
  if (condition) return;
  throw new Error(message);
};

const paragraph = (
  id: string,
  text: string,
  children: readonly BlockTreeNode[] = [],
): BlockTreeNode => ({
  id,
  type: "paragraph",
  props: {},
  content: [{ type: "text", text, styles: {} }],
  children,
});

const probeBlockId = (sequence: number): string =>
  createUuidV7FromTimestamp(1_784_000_000_000, sequence);

const blockIds = {
  hostAnchor: probeBlockId(1),
  template: probeBlockId(2),
  templateRoot: probeBlockId(3),
  templateChild: probeBlockId(4),
  templateReference: probeBlockId(5),
  invalidTemplate: probeBlockId(6),
  nestedOwner: probeBlockId(7),
  largeDocument: probeBlockId(8),
  largeParagraph: probeBlockId(9),
  largeCode: probeBlockId(10),
  faultOwner: probeBlockId(11),
  faultBody: probeBlockId(12),
} as const;

const readEpoch = (): string =>
  (
    getDb()
      .prepare("SELECT store_epoch FROM block_store_metadata WHERE id = 1")
      .get() as { readonly store_epoch: string }
  ).store_epoch;

const seedHost = (
  projectId: string,
  cardId: string,
  documentId: string,
): void => {
  const database = getDb();
  const now = new Date().toISOString();
  database
    .prepare(
      `
      INSERT INTO blocks (
        id, project_id, type, lifecycle, location_kind,
        containing_document_id, location_revision, metadata_revision,
        created_at, updated_at
      ) VALUES (?, ?, 'card', 'active', 'space', NULL, 1, 1, ?, ?)
    `,
    )
    .run(cardId, projectId, now, now);
  database
    .prepare(
      `INSERT INTO top_level_block_placements
       (block_id, project_id, rank_key, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(cardId, projectId, `probe:${cardId}`, now, now);
  database
    .prepare(
      `
      INSERT INTO documents (
        id, project_id, generation, head_seq, schema_key, schema_version,
        state_vector, state_hash, readiness, authority,
        genesis_source_revision, created_at, updated_at
      ) VALUES (?, ?, 1, 0, 'nodex.card', 1, X'', '',
        'pending_genesis', 'legacy_shadow', NULL, ?, ?)
    `,
    )
    .run(documentId, projectId, now, now);
  database
    .prepare(
      `INSERT INTO block_documents (block_id, document_id, project_id, created_at)
       VALUES (?, ?, ?, ?)`,
    )
    .run(cardId, documentId, projectId, now);
  const detached = createDetachedCardDocumentFromBlockTree({
    documentId,
    title: "Host",
    blockTree: [paragraph(blockIds.hostAnchor, "anchor")],
  });
  try {
    initializeBlockDocumentGenesis(database, {
      documentId,
      storeEpoch: readEpoch(),
      generation: 1,
      updateId: `genesis:${documentId}`,
      clientSessionId: "probe:genesis",
      update: Y.encodeStateAsUpdate(detached.document),
      finalAuthority: "ydoc_primary",
    });
  } finally {
    detached.document.destroy();
  }
};

const materialize = (documentId: string) => {
  const loaded = loadPrimaryBlockDocument(getDb(), documentId);
  try {
    return inspectOwnedBlockDocument(loaded.document, {
      ownerType: loaded.ownerType,
      schemaKey: loaded.head.schemaKey,
      schemaVersion: loaded.head.schemaVersion,
    }).materialization;
  } finally {
    loaded.document.destroy();
  }
};

const findText = (document: Y.Doc): Y.XmlText => {
  for (const node of document
    .getXmlFragment("body")
    .createTreeWalker(() => true)) {
    if (node instanceof Y.XmlText) return node;
  }
  throw new Error("Expected text in Block Document");
};

const main = async (): Promise<void> => {
  const previous = process.env.NODEX_DIR;
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "nodex-additional-documents-probe-"),
  );
  process.env.NODEX_DIR = directory;
  try {
    await initializeDatabase();
    const project = createProject({ name: "Additional Documents probe" });
    const storeEpoch = readEpoch();
    seedHost(project.id, "probe-host", "document:probe-host");

    const template = createReusableTemplateSource(getDb(), {
      version: ADDITIONAL_DOCUMENT_BEARING_OPERATION_VERSION,
      kind: "create_reusable_template_source",
      operationId: "probe:template:create",
      projectId: project.id,
      storeEpoch,
      clientSessionId: "probe:template-create",
      actor: { attempt: 1, surface: "probe" },
      sourceBlockId: blockIds.template,
      documentId: "document:probe-template",
      displayName: "Incident review",
      blockTree: [
        paragraph(blockIds.templateRoot, "Template", [
          paragraph(blockIds.templateChild, "Child"),
        ]),
      ],
    });
    const retry = createReusableTemplateSource(getDb(), {
      version: ADDITIONAL_DOCUMENT_BEARING_OPERATION_VERSION,
      kind: "create_reusable_template_source",
      operationId: "probe:template:create",
      projectId: project.id,
      storeEpoch,
      clientSessionId: "probe:template-retry",
      actor: { attempt: 2, surface: "lost-response" },
      sourceBlockId: blockIds.template,
      documentId: "document:probe-template",
      displayName: "Incident review",
      blockTree: [
        paragraph(blockIds.templateRoot, "Template", [
          paragraph(blockIds.templateChild, "Child"),
        ]),
      ],
    });
    invariant(!template.duplicate && retry.duplicate, "template receipt retry failed");
    invariant(
      getDocumentBearingBlockSummary(getDb(), project.id, blockIds.template)
        .displayName === "Incident review",
      "template summary lost its authoritative display name",
    );
    const templatePlacement = getDb()
      .prepare(
        `
        SELECT
          (SELECT COUNT(*) FROM top_level_block_placements WHERE block_id = ?) AS placements,
          (SELECT COUNT(*) FROM database_memberships WHERE card_block_id = ? AND removed_at IS NULL) AS memberships
      `,
      )
      .get(blockIds.template, blockIds.template) as {
      readonly placements: number;
      readonly memberships: number;
    };
    invariant(
      templatePlacement.placements === 1 && templatePlacement.memberships === 0,
      "Template source is not an independent non-Card library resource",
    );
    assertReusableTemplateSourceIsUnreferenced(
      getDb(),
      project.id,
      blockIds.template,
    );
    createReusableTemplateReference(getDb(), {
      version: ADDITIONAL_DOCUMENT_BEARING_OPERATION_VERSION,
      kind: "create_reusable_template_reference",
      operationId: "probe:template:reference",
      projectId: project.id,
      storeEpoch,
      clientSessionId: "probe:template-reference",
      actor: {},
      sourceBlockId: blockIds.template,
      sourceDocumentId: "document:probe-template",
      expectedSourceGeneration: 1,
      expectedSourceHeadSeq: 1,
      hostDocumentId: "document:probe-host",
      expectedHostGeneration: 1,
      expectedHostHeadSeq: 1,
      referenceBlockId: blockIds.templateReference,
    });
    let referenceGuarded = false;
    try {
      assertReusableTemplateSourceIsUnreferenced(
        getDb(),
        project.id,
        blockIds.template,
      );
    } catch (error) {
      referenceGuarded =
        error instanceof AdditionalDocumentBearingBlockError &&
        error.code === "source_referenced";
    }
    invariant(referenceGuarded, "referenced Template source passed the GC guard");
    instantiateReusableTemplate(getDb(), {
      version: ADDITIONAL_DOCUMENT_BEARING_OPERATION_VERSION,
      kind: "instantiate_reusable_template",
      operationId: "probe:template:instantiate",
      projectId: project.id,
      storeEpoch,
      clientSessionId: "probe:template-instance",
      actor: {},
      sourceBlockId: blockIds.template,
      sourceDocumentId: "document:probe-template",
      expectedSourceGeneration: 1,
      expectedSourceHeadSeq: 1,
      targetDocumentId: "document:probe-host",
      expectedTargetGeneration: 1,
      expectedTargetHeadSeq: 2,
    });
    const hostAfterTemplate = materialize("document:probe-host");
    invariant(
      hostAfterTemplate.blockTree[1]?.type === REUSABLE_TEMPLATE_REFERENCE_TYPE &&
        hostAfterTemplate.blockTree[1]?.children.length === 0,
      "template reference embedded source content",
    );
    invariant(
      hostAfterTemplate.blockTree[2]?.id !== blockIds.templateRoot &&
        hostAfterTemplate.blockTree[2]?.children[0]?.id !==
          blockIds.templateChild,
      "template instance reused source identities",
    );
    const instantiatedRootId = hostAfterTemplate.blockTree[2]?.id;
    invariant(
      typeof instantiatedRootId === "string" &&
        getDb()
          .prepare(
            "SELECT 1 FROM block_documents WHERE block_id = ?",
          )
          .get(instantiatedRootId) === undefined,
      "ordinary instantiated paragraph was implicitly promoted to a Document",
    );

    let invalidTemplateRejections = 0;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        createReusableTemplateSource(getDb(), {
          version: ADDITIONAL_DOCUMENT_BEARING_OPERATION_VERSION,
          kind: "create_reusable_template_source",
          operationId: "probe:template:invalid-nested-owner",
          projectId: project.id,
          storeEpoch,
          clientSessionId: `probe:invalid-template:${attempt}`,
          actor: { attempt },
          sourceBlockId: blockIds.invalidTemplate,
          documentId: "document:probe-invalid-template",
          displayName: "Invalid",
          blockTree: [
            {
              id: blockIds.nestedOwner,
              type: LARGE_DOCUMENT_BLOCK_TYPE,
              props: { displayName: "Nested" },
              children: [],
            },
          ],
        });
      } catch (error) {
        if (
          error instanceof AdditionalDocumentBearingBlockError &&
          error.code === "invalid_request"
        ) {
          invalidTemplateRejections += 1;
        }
      }
    }
    invariant(
      invalidTemplateRejections === 2 &&
        (
          getDb()
            .prepare(
              `SELECT outcome FROM block_mutations
               WHERE mutation_id = 'probe:template:invalid-nested-owner'`,
            )
            .get() as { readonly outcome: string }
        ).outcome === "rejected",
      "invalid Template ownership did not produce one durable typed rejection",
    );

    createExplicitDocumentBearingBlock(getDb(), {
      version: ADDITIONAL_DOCUMENT_BEARING_OPERATION_VERSION,
      kind: "create_explicit_document_bearing_block",
      operationId: "probe:large-document:create",
      projectId: project.id,
      storeEpoch,
      clientSessionId: "probe:large-document",
      actor: {},
      blockKind: "large_document",
      blockId: blockIds.largeDocument,
      documentId: "document:probe-large-document",
      displayName: "Architecture",
      blockTree: [paragraph(blockIds.largeParagraph, "Foreign body")],
      location: {
        kind: "document",
        hostDocumentId: "document:probe-host",
        expectedHostGeneration: 1,
        expectedHostHeadSeq: 3,
      },
    });
    const hostWithShell = materialize("document:probe-host");
    invariant(
      hostWithShell.blockTree.at(-1)?.type === LARGE_DOCUMENT_BLOCK_TYPE &&
        !hostWithShell.plainText.includes("Foreign body"),
      "Large Document shell embedded its owned body",
    );

    createExplicitDocumentBearingBlock(getDb(), {
      version: ADDITIONAL_DOCUMENT_BEARING_OPERATION_VERSION,
      kind: "create_explicit_document_bearing_block",
      operationId: "probe:large-code:create",
      projectId: project.id,
      storeEpoch,
      clientSessionId: "probe:large-code",
      actor: {},
      blockKind: "large_code",
      blockId: blockIds.largeCode,
      documentId: "document:probe-large-code",
      displayName: "Sync",
      code: "base",
      language: "typescript",
      location: { kind: "space" },
    });
    const codeBase = loadPrimaryBlockDocument(getDb(), "document:probe-large-code");
    const full = Y.encodeStateAsUpdate(codeBase.document);
    codeBase.document.destroy();
    const left = new Y.Doc({ guid: "document:probe-large-code" });
    const right = new Y.Doc({ guid: "document:probe-large-code" });
    Y.applyUpdate(left, full);
    Y.applyUpdate(right, full);
    const leftVector = Y.encodeStateVector(left);
    const rightVector = Y.encodeStateVector(right);
    findText(left).insert(0, "L");
    findText(right).insert(findText(right).length, "R");
    applyBlockDocumentUpdate(getDb(), {
      documentId: "document:probe-large-code",
      storeEpoch,
      generation: 1,
      updateId: "probe:large-code:left",
      clientSessionId: "probe:left",
      baseHeadSeq: 1,
      touchedBlockIds: [],
      update: Y.encodeStateAsUpdate(left, leftVector),
    });
    applyBlockDocumentUpdate(getDb(), {
      documentId: "document:probe-large-code",
      storeEpoch,
      generation: 1,
      updateId: "probe:large-code:right",
      clientSessionId: "probe:right",
      baseHeadSeq: 1,
      touchedBlockIds: [],
      update: Y.encodeStateAsUpdate(right, rightVector),
    });
    left.destroy();
    right.destroy();
    invariant(
      materialize("document:probe-large-code").plainText === "LbaseR",
      "Large Code clients did not converge",
    );
    const checkpoint = createDocumentVersionCheckpoint(getDb(), {
      version: DOCUMENT_VERSION_CONTRACT_VERSION,
      projectId: project.id,
      storeEpoch,
      documentId: "document:probe-large-code",
      expectedGeneration: 1,
      expectedHeadSeq: 3,
      cause: "manual",
      actor: {},
    }).checkpoint;
    invariant(
      checkpoint.materializationKind === "large_code" && checkpoint.title === null,
      "Large Code did not reuse generic Document history",
    );

    const relocate: RelocateBlocks = {
      relocationId: "probe:large-document:relocate-body",
      projectId: project.id,
      storeEpoch,
      rootBlockIds: [blockIds.largeParagraph],
      sourceDocumentId: "document:probe-large-document",
      sourceGeneration: 1,
      expectedSourceHeadSeq: 1,
      expectedLocationRevisions: { [blockIds.largeParagraph]: 1 },
      target: {
        kind: "document",
        documentId: "document:probe-host",
        generation: 1,
        expectedHeadSeq: 4,
        beforeBlockId: blockIds.largeDocument,
      },
    };
    const relocated = relocateBlocksAtomically(getDb(), relocate);
    const emptiedLargeDocument = materialize("document:probe-large-document");
    invariant(
      relocated.targetCommit?.headSeq === 5 &&
        emptiedLargeDocument.nfm === "" &&
        emptiedLargeDocument.blockTree.length === 1 &&
        emptiedLargeDocument.blockTree[0]?.type === "paragraph" &&
        isUuidV7(emptiedLargeDocument.blockTree[0]?.id ?? "") &&
        materialize("document:probe-host").blockTree.some(
          (block) => block.id === blockIds.largeParagraph,
        ),
      "Large Document did not reuse atomic relocation",
    );

    let rolledBack = false;
    try {
      createExplicitDocumentBearingBlock(
        getDb(),
        {
          version: ADDITIONAL_DOCUMENT_BEARING_OPERATION_VERSION,
          kind: "create_explicit_document_bearing_block",
          operationId: "probe:fault",
          projectId: project.id,
          storeEpoch,
          clientSessionId: "probe:fault",
          actor: {},
          blockKind: "large_document",
          blockId: blockIds.faultOwner,
          documentId: "document:probe-fault",
          displayName: "Fault",
          blockTree: [paragraph(blockIds.faultBody, "rollback")],
          location: { kind: "space" },
        },
        {
          faultInjector: (point) => {
            if (point === "before_receipt") throw new Error("fault");
          },
        },
      );
    } catch (error) {
      rolledBack = error instanceof Error && error.message === "fault";
    }
    invariant(rolledBack, "fault injection was not observed");
    invariant(
      getDb()
        .prepare("SELECT 1 FROM blocks WHERE id = ?")
        .get(blockIds.faultOwner) === undefined &&
        getDb()
          .prepare("SELECT 1 FROM documents WHERE id = 'document:probe-fault'")
          .get() === undefined,
      "faulted owner/Document escaped the transaction",
    );
    const originalActor = getDb()
      .prepare(
        `SELECT actor_json, client_session_id FROM block_mutations
         WHERE mutation_id = 'probe:template:create'`,
      )
      .get() as {
      readonly actor_json: string;
      readonly client_session_id: string;
    };
    invariant(
      originalActor.actor_json.includes('"attempt":1') &&
        originalActor.client_session_id === "probe:template-create",
      "retry replaced first-attempt audit identity",
    );
    const ownerTypes = getDb()
      .prepare(
        "SELECT type FROM blocks WHERE id IN (?, ?) ORDER BY type",
      )
      .all(blockIds.largeCode, blockIds.largeDocument) as readonly {
      readonly type: string;
    }[];
    invariant(
      ownerTypes.some((row) => row.type === LARGE_CODE_BLOCK_TYPE) &&
        ownerTypes.some((row) => row.type === LARGE_DOCUMENT_BLOCK_TYPE),
      "registered explicit owner types were not durable",
    );

    process.stdout.write(
      `${JSON.stringify({
        bodyOnly: true,
        templateReference: true,
        instantiateRenewsIds: true,
        sourceStable: true,
        foreignBodyExcluded: true,
        largeCodeConverged: true,
        history: true,
        relocation: true,
        exactRetry: true,
        firstAudit: true,
        faultRollback: true,
        typedRejection: true,
        ordinaryNotPromoted: true,
        referencedSourceGuard: true,
        libraryPlacement: true,
      })}\n`,
    );
  } finally {
    closeDatabase();
    if (previous === undefined) delete process.env.NODEX_DIR;
    else process.env.NODEX_DIR = previous;
    fs.rmSync(directory, { recursive: true, force: true });
  }
};

void main();
