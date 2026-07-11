import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  CARD_HISTORY_CONTRACT_VERSION,
  MAX_CARD_HISTORY_PAGE_SIZE,
  type CardHistoryEntry,
} from "../src/shared/card-history";
import { parseCardLifecycleMutationRequest } from "../src/shared/card-lifecycle";
import { DOCUMENT_VERSION_CONTRACT_VERSION } from "../src/shared/block-documents/document-history";
import { applyCardLifecycleMutation } from "../src/main/local-store/card-block-lifecycle";
import {
  CardHistoryStoreError,
  listCardHistory,
} from "../src/main/local-store/card-history";
import {
  closeDatabase,
  getDb,
  initializeDatabase,
} from "../src/main/local-store/database";
import { createDocumentVersionCheckpoint } from "../src/main/local-store/document-versions";
import { createProject } from "../src/main/local-store/projects";

const T0 = "2026-06-01T10:00:00.000Z";
const T1 = "2026-06-01T10:01:00.000Z";
const T2 = "2026-06-01T10:02:00.000Z";
const T3 = "2026-06-01T10:03:00.000Z";
const T4 = "2026-06-01T10:04:00.000Z";

interface Fixture {
  readonly database: ReturnType<typeof getDb>;
  readonly projectId: string;
  readonly storeEpoch: string;
}

interface CardFixture {
  readonly cardId: string;
  readonly documentId: string;
}

const assert = (condition: boolean, message: string): void => {
  if (condition) return;
  throw new Error(message);
};

const createCard = (
  fixture: Fixture,
  cardId: string,
  committedAt = T0,
): CardFixture => {
  const result = applyCardLifecycleMutation(
    fixture.database,
    parseCardLifecycleMutationRequest({
      version: 1,
      operationId: `history-probe:create:${cardId}`,
      projectId: fixture.projectId,
      storeEpoch: fixture.storeEpoch,
      clientSessionId: "history-runtime-probe",
      actor: { displayName: "History runtime probe", kind: "probe" },
      operation: {
        kind: "create_card",
        cardId,
        title: "History runtime Card",
        nfm: "Canonical Card body",
        status: "draft",
      },
    }),
    {
      now: () => committedAt,
      allocateBodyBlockId: () => `body:${cardId}`,
    },
  );
  if (!result.ok) throw new Error(result.error.message);
  return { cardId, documentId: result.value.documentId };
};

const insertMutation = (
  fixture: Fixture,
  card: CardFixture,
  input: {
    readonly mutationId: string;
    readonly committedAt: string;
    readonly actor?: Readonly<Record<string, unknown>>;
    readonly payloadRequestHash?: string;
  },
): number => {
  const requestJson = JSON.stringify({ mutationId: input.mutationId });
  const requestHash = createHash("sha256").update(requestJson).digest("hex");
  const blockIds = JSON.stringify([card.cardId]);
  const documentIds = JSON.stringify([card.documentId]);
  const fieldIntents = JSON.stringify([
    { path: `blocks.${card.cardId}.priority`, operation: "set" },
  ]);
  const apply = fixture.database.transaction(() => {
    const change = fixture.database
      .prepare(
        `
        INSERT INTO change_log (
          project_id, store_epoch, kind, operation_id, block_ids_json,
          document_ids_json, database_block_ids_json, payload_json, committed_at
        ) VALUES (?, ?, 'block_mutation', ?, ?, ?, '[]', ?, ?)
      `,
      )
      .run(
        fixture.projectId,
        fixture.storeEpoch,
        input.mutationId,
        blockIds,
        documentIds,
        JSON.stringify({
          mutationKind: "property_batch",
          requestHash: input.payloadRequestHash ?? requestHash,
        }),
        input.committedAt,
      );
    const changeSeq = Number(change.lastInsertRowid);
    fixture.database
      .prepare(
        `
        INSERT INTO block_mutations (
          mutation_id, project_id, store_epoch, mutation_kind, actor_json,
          client_session_id, request_hash, request_json, target_block_ids_json,
          affected_document_ids_json, affected_database_block_ids_json,
          field_intents_json, expected_revisions_json, outcome, result_json,
          committed_revisions_json, document_heads_json, change_log_seq,
          recorded_at
        ) VALUES (
          ?, ?, ?, 'property_batch', ?, 'history-runtime-probe', ?, ?, ?, ?,
          '[]', ?, '{}', 'committed', '{}', '{}', '{}', ?, ?
        )
      `,
      )
      .run(
        input.mutationId,
        fixture.projectId,
        fixture.storeEpoch,
        JSON.stringify(input.actor ?? { displayName: "Property editor" }),
        requestHash,
        requestJson,
        blockIds,
        documentIds,
        fieldIntents,
        changeSeq,
        input.committedAt,
      );
    return changeSeq;
  });
  return apply.immediate();
};

const insertBareRelocation = (
  fixture: Fixture,
  card: CardFixture,
  input: {
    readonly operationId: string;
    readonly committedAt: string;
    readonly projectId?: string;
  },
): number => {
  const inserted = fixture.database
    .prepare(
      `
      INSERT INTO change_log (
        project_id, store_epoch, kind, operation_id, block_ids_json,
        document_ids_json, database_block_ids_json, payload_json, committed_at
      ) VALUES (?, ?, 'block_relocation', ?, ?, ?, '[]', '{}', ?)
    `,
    )
    .run(
      input.projectId ?? fixture.projectId,
      fixture.storeEpoch,
      input.operationId,
      JSON.stringify([card.cardId]),
      JSON.stringify([card.documentId]),
      input.committedAt,
    );
  return Number(inserted.lastInsertRowid);
};

const checkpoint = (
  fixture: Fixture,
  card: CardFixture,
  input: {
    readonly createdAt: string;
    readonly cause?: string;
    readonly label?: string;
    readonly actor?: Readonly<Record<string, string>>;
  },
) =>
  createDocumentVersionCheckpoint(
    fixture.database,
    {
      version: DOCUMENT_VERSION_CONTRACT_VERSION,
      projectId: fixture.projectId,
      storeEpoch: fixture.storeEpoch,
      documentId: card.documentId,
      expectedGeneration: 1,
      expectedHeadSeq: 1,
      cause: input.cause ?? "manual",
      ...(input.label === undefined ? {} : { label: input.label }),
      actor: input.actor ?? { displayName: "Checkpoint author" },
    },
    { now: () => input.createdAt },
  ).checkpoint;

const readErrorCode = (operation: () => unknown): string | null => {
  try {
    operation();
    return null;
  } catch (error) {
    return error instanceof CardHistoryStoreError ? error.code : "unexpected";
  }
};

const main = async (): Promise<void> => {
  const previousDir = process.env.NODEX_DIR;
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "nodex-card-history-runtime-"),
  );
  process.env.NODEX_DIR = directory;
  try {
    await initializeDatabase();
    const project = createProject({ name: "Card history runtime probe" });
    const database = getDb();
    const metadata = database
      .prepare("SELECT store_epoch FROM block_store_metadata WHERE id = 1")
      .get() as { readonly store_epoch: string };
    const fixture: Fixture = {
      database,
      projectId: project.id,
      storeEpoch: metadata.store_epoch,
    };

    const mergeCard = createCard(fixture, "history-runtime-merge");
    insertBareRelocation(fixture, mergeCard, {
      operationId: "history-runtime:missing-relocation-ledger",
      committedAt: T1,
    });
    const mutationSeq = insertMutation(fixture, mergeCard, {
      mutationId: "history-runtime:property",
      committedAt: T2,
    });
    const version = checkpoint(fixture, mergeCard, {
      createdAt: T2,
      label: "Before runtime property change",
    });
    const first = listCardHistory(database, {
      version: CARD_HISTORY_CONTRACT_VERSION,
      projectId: fixture.projectId,
      cardBlockId: mergeCard.cardId,
      pageSize: 1,
    });
    assert(
      first.entries[0]?.kind === "document_version" &&
        first.entries[0].versionMetadata.versionId === version.versionId,
      "Document version did not win same-time merge ordering",
    );
    assert(first.nextCursor !== null, "Merged history did not return a cursor");
    const second = listCardHistory(database, {
      version: CARD_HISTORY_CONTRACT_VERSION,
      projectId: fixture.projectId,
      cardBlockId: mergeCard.cardId,
      before: first.nextCursor ?? undefined,
      pageSize: 1,
    });
    assert(
      second.entries[0]?.kind === "block_mutation" &&
        second.entries[0].changeSeq === mutationSeq &&
        second.entries[0].evidence.status === "verified",
      "Mutation was lost or unverified after the cross-source cursor",
    );
    const repeated = listCardHistory(database, {
      version: CARD_HISTORY_CONTRACT_VERSION,
      projectId: fixture.projectId,
      cardBlockId: mergeCard.cardId,
      before: first.nextCursor ?? undefined,
      pageSize: 1,
    });
    const stableCursor = JSON.stringify(repeated) === JSON.stringify(second);
    assert(stableCursor, "Repeated cursor reads diverged");
    const mergedTimeline = listCardHistory(database, {
      version: CARD_HISTORY_CONTRACT_VERSION,
      projectId: fixture.projectId,
      cardBlockId: mergeCard.cardId,
    });
    assert(
      mergedTimeline.entries.some(
        (entry) =>
          entry.kind === "block_mutation" &&
          entry.display.title === "Created Card" &&
          entry.evidence.status === "verified",
      ),
      "Canonical Card lifecycle evidence was not decoded",
    );

    const beforeForeign = listCardHistory(database, {
      version: CARD_HISTORY_CONTRACT_VERSION,
      projectId: fixture.projectId,
      cardBlockId: mergeCard.cardId,
    });
    const foreign = createProject({ name: "Foreign history runtime scope" });
    insertBareRelocation(fixture, mergeCard, {
      operationId: "history-runtime:foreign-change",
      committedAt: T4,
      projectId: foreign.id,
    });
    const afterForeign = listCardHistory(database, {
      version: CARD_HISTORY_CONTRACT_VERSION,
      projectId: fixture.projectId,
      cardBlockId: mergeCard.cardId,
    });
    const projectScope =
      JSON.stringify(beforeForeign) === JSON.stringify(afterForeign) &&
      readErrorCode(() =>
        listCardHistory(database, {
          version: CARD_HISTORY_CONTRACT_VERSION,
          projectId: foreign.id,
          cardBlockId: mergeCard.cardId,
        }),
      ) === "card_not_found";
    assert(projectScope, "Card history leaked across Project scope");

    const malformedCard = createCard(fixture, "history-runtime-malformed");
    insertMutation(fixture, malformedCard, {
      mutationId: "history-runtime:bad-hash",
      committedAt: T2,
      payloadRequestHash: "f".repeat(64),
    });
    insertMutation(fixture, malformedCard, {
      mutationId: "history-runtime:oversized-actor",
      committedAt: T3,
      actor: { displayName: "x".repeat(300_000) },
    });
    const malformedPage = listCardHistory(database, {
      version: CARD_HISTORY_CONTRACT_VERSION,
      projectId: fixture.projectId,
      cardBlockId: malformedCard.cardId,
    });
    const malformedEvidence =
      malformedPage.entries[0]?.evidence.status === "unavailable" &&
      malformedPage.entries[1]?.evidence.status === "unavailable" &&
      malformedPage.entries[0]?.display.category === "unknown" &&
      JSON.stringify(malformedPage.entries[0]).length < 2_000;
    assert(
      malformedEvidence,
      "Malformed evidence was trusted or leaked raw JSON",
    );

    const boundedCard = createCard(fixture, "history-runtime-bounds");
    checkpoint(fixture, boundedCard, {
      createdAt: T3,
      label: "L".repeat(512),
      actor: { displayName: "A".repeat(400) },
    });
    const boundedEntry = listCardHistory(database, {
      version: CARD_HISTORY_CONTRACT_VERSION,
      projectId: fixture.projectId,
      cardBlockId: boundedCard.cardId,
    }).entries[0];
    const boundedOutput =
      boundedEntry?.kind === "document_version" &&
      (boundedEntry.display.detail?.length ?? 0) <= 180 &&
      (boundedEntry.display.actorLabel?.length ?? 0) <= 120 &&
      !("fullUpdate" in boundedEntry) &&
      readErrorCode(() =>
        listCardHistory(database, {
          version: CARD_HISTORY_CONTRACT_VERSION,
          projectId: fixture.projectId,
          cardBlockId: boundedCard.cardId,
          pageSize: MAX_CARD_HISTORY_PAGE_SIZE + 1,
        }),
      ) === "invalid_card_history_request";
    assert(boundedOutput, "History output or request budget was not bounded");

    const standaloneCard = createCard(fixture, "history-runtime-standalone");
    const membership = database
      .prepare(
        `
        SELECT id FROM database_memberships
        WHERE project_id = ? AND card_block_id = ? AND removed_at IS NULL
      `,
      )
      .get(fixture.projectId, standaloneCard.cardId) as { readonly id: string };
    database
      .transaction(() => {
        database
          .prepare(
            "DELETE FROM database_view_positions WHERE project_id = ? AND block_id = ?",
          )
          .run(fixture.projectId, standaloneCard.cardId);
        database
          .prepare(
            `
          UPDATE database_memberships
          SET removed_at = ?, revision = revision + 1
          WHERE id = ? AND project_id = ?
        `,
          )
          .run(T1, membership.id, fixture.projectId);
      })
      .immediate();
    checkpoint(fixture, standaloneCard, { createdAt: T2 });
    const standalonePage = listCardHistory(database, {
      version: CARD_HISTORY_CONTRACT_VERSION,
      projectId: fixture.projectId,
      cardBlockId: standaloneCard.cardId,
    });
    const activeMemberships = database
      .prepare(
        `
        SELECT COUNT(*) AS count FROM database_memberships
        WHERE card_block_id = ? AND project_id = ? AND removed_at IS NULL
      `,
      )
      .get(standaloneCard.cardId, fixture.projectId) as {
      readonly count: number;
    };
    const standalone =
      activeMemberships.count === 0 &&
      standalonePage.documentId === standaloneCard.documentId &&
      standalonePage.entries[0]?.kind === "document_version" &&
      standalonePage.entries.every(
        (entry: CardHistoryEntry) =>
          entry.cardBlockId === standaloneCard.cardId,
      );
    assert(
      standalone,
      "Standalone Card history required a Database membership",
    );

    console.log(
      JSON.stringify({
        mergedSources: true,
        stableCursor,
        projectScope,
        malformedEvidence,
        boundedOutput,
        standalone,
      }),
    );
  } finally {
    closeDatabase();
    fs.rmSync(directory, { recursive: true, force: true });
    if (previousDir === undefined) {
      delete process.env.NODEX_DIR;
    } else {
      process.env.NODEX_DIR = previousDir;
    }
  }
};

void main();
