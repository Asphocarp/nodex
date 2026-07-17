import { describe, expect, test } from "vitest";
import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import {
  PAGE_HISTORY_CONTRACT_VERSION,
  MAX_PAGE_HISTORY_PAGE_SIZE,
  type PageHistoryEntry,
  type ListPageHistoryRequest,
} from "../../shared/page-history";
import { PageHistoryStoreError, listPageHistory } from "./page-history";

const T0 = "2026-06-01T10:00:00.000Z";
const T1 = "2026-06-01T10:01:00.000Z";
const T2 = "2026-06-01T10:02:00.000Z";
const T3 = "2026-06-01T10:03:00.000Z";
const T4 = "2026-06-01T10:04:00.000Z";

interface Fixture {
  readonly database: Database.Database;
  readonly projectId: string;
  readonly libraryId: string;
  readonly databaseId: string;
  readonly dataSourceId: string;
  readonly storeEpoch: string;
}

interface CardFixture {
  readonly cardId: string;
  readonly documentId: string;
}

const createSchema = (database: Database.Database): void => {
  database.exec(`
    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      library_id TEXT NOT NULL,
      database_block_id TEXT NOT NULL,
      lifecycle TEXT NOT NULL
    );
    CREATE TABLE pages (
      block_id TEXT PRIMARY KEY,
      library_id TEXT NOT NULL,
      parent_kind TEXT NOT NULL,
      parent_id TEXT NOT NULL,
      lifecycle TEXT NOT NULL DEFAULT 'active'
    );
    CREATE TABLE data_sources (
      id TEXT PRIMARY KEY,
      library_id TEXT NOT NULL,
      home_database_block_id TEXT NOT NULL,
      lifecycle TEXT NOT NULL DEFAULT 'active'
    );
    CREATE TABLE project_resource_grants (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      library_id TEXT NOT NULL,
      root_kind TEXT NOT NULL,
      root_id TEXT NOT NULL,
      access TEXT NOT NULL,
      recursive INTEGER NOT NULL,
      revision INTEGER NOT NULL,
      lifecycle TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE blocks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      type TEXT NOT NULL
    );
    CREATE TABLE documents (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      generation INTEGER NOT NULL,
      readiness TEXT NOT NULL
    );
    CREATE TABLE block_documents (
      block_id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      project_id TEXT NOT NULL
    );
    CREATE TABLE document_versions (
      version_id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      generation INTEGER NOT NULL,
      base_head_seq INTEGER NOT NULL,
      schema_key TEXT NOT NULL,
      schema_version INTEGER NOT NULL,
      cause TEXT NOT NULL,
      label TEXT,
      actor_json TEXT NOT NULL,
      revision_kind TEXT NOT NULL DEFAULT 'manual',
      source_mutation_id TEXT,
      source_change_seq INTEGER,
      pinned INTEGER NOT NULL DEFAULT 1,
      checkpoint_hash TEXT NOT NULL,
      byte_length INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE change_log (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL,
      store_epoch TEXT NOT NULL,
      kind TEXT NOT NULL,
      operation_id TEXT,
      block_ids_json TEXT NOT NULL,
      document_ids_json TEXT NOT NULL,
      database_block_ids_json TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      committed_at TEXT NOT NULL
    );
    CREATE TABLE block_mutations (
      mutation_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      store_epoch TEXT NOT NULL,
      mutation_kind TEXT NOT NULL,
      actor_json TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      target_block_ids_json TEXT NOT NULL,
      affected_document_ids_json TEXT NOT NULL,
      affected_database_block_ids_json TEXT NOT NULL,
      field_intents_json TEXT NOT NULL,
      outcome TEXT NOT NULL,
      change_log_seq INTEGER
    );
    CREATE TABLE block_relocations (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      store_epoch TEXT NOT NULL,
      status TEXT NOT NULL,
      source_document_id TEXT NOT NULL,
      target_document_id TEXT,
      root_block_ids_json TEXT NOT NULL,
      result_json TEXT NOT NULL,
      change_log_seq INTEGER NOT NULL,
      committed_at TEXT NOT NULL
    );
    CREATE TABLE data_source_page_memberships (
      id TEXT PRIMARY KEY,
      page_block_id TEXT NOT NULL,
      removed_at TEXT
    );
  `);
};

const withFixture = (run: (fixture: Fixture) => void): void => {
  const database = new Database(":memory:");
  createSchema(database);
  try {
    const fixture = {
      database,
      projectId: "project:history",
      libraryId: "library:history",
      databaseId: "database:history",
      dataSourceId: "data-source:history",
      storeEpoch: "store:history",
    } as const;
    database.prepare(`
      INSERT INTO projects (id, library_id, database_block_id, lifecycle)
      VALUES (?, ?, ?, 'active')
    `).run(fixture.projectId, fixture.libraryId, fixture.databaseId);
    database.prepare(`
      INSERT INTO data_sources (id, library_id, home_database_block_id)
      VALUES (?, ?, ?)
    `).run(fixture.dataSourceId, fixture.libraryId, fixture.databaseId);
    run(fixture);
  } finally {
    database.close();
  }
};

const historyRequest = (
  fixture: Fixture,
  cardId: string,
): Pick<
  ListPageHistoryRequest,
  "version" | "requestingProjectId" | "pageId"
> => ({
  version: PAGE_HISTORY_CONTRACT_VERSION,
  requestingProjectId: fixture.projectId,
  pageId: cardId,
});

const insertMutation = (
  fixture: Fixture,
  card: CardFixture,
  input: {
    readonly mutationId: string;
    readonly committedAt: string;
    readonly mutationKind?: string;
    readonly actor?: Readonly<Record<string, unknown>>;
    readonly payload?: Readonly<Record<string, unknown>>;
    readonly payloadRequestHash?: string;
  },
): number => {
  const mutationKind = input.mutationKind ?? "property_batch";
  const requestJson = JSON.stringify({ mutationId: input.mutationId });
  const requestHash = createHash("sha256").update(requestJson).digest("hex");
  const blockIds = JSON.stringify([card.cardId]);
  const documentIds = JSON.stringify([card.documentId]);
  const databaseIds = "[]";
  const fieldIntents = JSON.stringify([
    { path: `blocks.${card.cardId}.priority`, operation: "set" },
  ]);
  const change = fixture.database
    .prepare(
      `
      INSERT INTO change_log (
        project_id, store_epoch, kind, operation_id, block_ids_json,
        document_ids_json, database_block_ids_json, payload_json, committed_at
      ) VALUES (?, ?, 'block_mutation', ?, ?, ?, ?, ?, ?)
    `,
    )
    .run(
      fixture.projectId,
      fixture.storeEpoch,
      input.mutationId,
      blockIds,
      documentIds,
      databaseIds,
      JSON.stringify({
        mutationKind,
        requestHash: input.payloadRequestHash ?? requestHash,
        ...(input.payload ?? {}),
      }),
      input.committedAt,
    );
  const changeSeq = Number(change.lastInsertRowid);
  fixture.database
    .prepare(
      `
      INSERT INTO block_mutations (
        mutation_id, project_id, store_epoch, mutation_kind, actor_json,
        request_hash, target_block_ids_json, affected_document_ids_json,
        affected_database_block_ids_json, field_intents_json, outcome,
        change_log_seq
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'committed', ?)
    `,
    )
    .run(
      input.mutationId,
      fixture.projectId,
      fixture.storeEpoch,
      mutationKind,
      JSON.stringify(input.actor ?? { displayName: "Property editor" }),
      requestHash,
      blockIds,
      documentIds,
      databaseIds,
      fieldIntents,
      changeSeq,
    );
  return changeSeq;
};

const createCard = (fixture: Fixture, cardId: string): CardFixture => {
  const card = { cardId, documentId: `document:${cardId}` };
  fixture.database
    .prepare("INSERT INTO blocks (id, project_id, type) VALUES (?, ?, 'page')")
    .run(card.cardId, fixture.projectId);
  fixture.database.prepare(`
    INSERT INTO pages (block_id, library_id, parent_kind, parent_id)
    VALUES (?, ?, 'data_source', ?)
  `).run(card.cardId, fixture.libraryId, fixture.dataSourceId);
  fixture.database
    .prepare(
      `
      INSERT INTO documents (id, project_id, generation, readiness)
      VALUES (?, ?, 1, 'ready')
    `,
    )
    .run(card.documentId, fixture.projectId);
  fixture.database
    .prepare(
      `
      INSERT INTO block_documents (block_id, document_id, project_id)
      VALUES (?, ?, ?)
    `,
    )
    .run(card.cardId, card.documentId, fixture.projectId);
  insertMutation(fixture, card, {
    mutationId: `create:${cardId}`,
    committedAt: T0,
    mutationKind: "page_lifecycle",
    actor: { displayName: "History tester" },
    payload: { operation: "create_page" },
  });
  return card;
};

let versionOrdinal = 0;
const checkpoint = (
  fixture: Fixture,
  card: CardFixture,
  input: {
    readonly createdAt: string;
    readonly cause?: string;
    readonly label?: string;
    readonly actor?: Readonly<Record<string, string>>;
    readonly revisionKind?: "automatic" | "manual" | "operation" | "restore" | "safety";
    readonly sourceMutationId?: string;
    readonly sourceChangeSeq?: number;
  },
) => {
  versionOrdinal += 1;
  const versionId = `version:${versionOrdinal.toString().padStart(4, "0")}`;
  const checkpointHash = createHash("sha256").update(versionId).digest("hex");
  fixture.database
    .prepare(
      `
      INSERT INTO document_versions (
        version_id, document_id, project_id, generation, base_head_seq,
        schema_key, schema_version, cause, label, actor_json,
        revision_kind, source_mutation_id, source_change_seq, pinned,
        checkpoint_hash, byte_length, created_at
      ) VALUES (?, ?, ?, 1, 1, 'nodex.page', 1, ?, ?, ?, ?, ?, ?, ?, ?, 32, ?)
    `,
    )
    .run(
      versionId,
      card.documentId,
      fixture.projectId,
      input.cause ?? "manual",
      input.label ?? null,
      JSON.stringify(input.actor ?? { displayName: "Checkpoint author" }),
      input.revisionKind ?? "manual",
      input.sourceMutationId ?? null,
      input.sourceChangeSeq ?? null,
      input.revisionKind === "operation" ||
        input.revisionKind === "automatic" ||
        input.revisionKind === "safety"
        ? 0
        : 1,
      checkpointHash,
      input.createdAt,
    );
  return { versionId };
};

const insertRelocation = (
  fixture: Fixture,
  card: CardFixture,
  input: {
    readonly operationId: string;
    readonly committedAt: string;
    readonly withLedger: boolean;
    readonly projectId?: string;
  },
): number => {
  const projectId = input.projectId ?? fixture.projectId;
  const movedBlockId = `moved:${input.operationId}`;
  const sourceDocumentId = `source:${input.operationId}`;
  const change = fixture.database
    .prepare(
      `
      INSERT INTO change_log (
        project_id, store_epoch, kind, operation_id, block_ids_json,
        document_ids_json, database_block_ids_json, payload_json, committed_at
      ) VALUES (?, ?, 'block_relocation', ?, ?, ?, '[]', '{}', ?)
    `,
    )
    .run(
      projectId,
      fixture.storeEpoch,
      input.operationId,
      JSON.stringify([movedBlockId]),
      JSON.stringify([sourceDocumentId, card.documentId]),
      input.committedAt,
    );
  const changeSeq = Number(change.lastInsertRowid);
  if (!input.withLedger) return changeSeq;
  fixture.database
    .prepare(
      `
      INSERT INTO block_relocations (
        id, project_id, store_epoch, status, source_document_id,
        target_document_id, root_block_ids_json, result_json,
        change_log_seq, committed_at
      ) VALUES (?, ?, ?, 'committed', ?, ?, ?, '{}', ?, ?)
    `,
    )
    .run(
      input.operationId,
      projectId,
      fixture.storeEpoch,
      sourceDocumentId,
      card.documentId,
      JSON.stringify([movedBlockId]),
      changeSeq,
      input.committedAt,
    );
  return changeSeq;
};

const errorCode = (operation: () => unknown): string | null => {
  try {
    operation();
    return null;
  } catch (error) {
    return error instanceof PageHistoryStoreError ? error.code : "unexpected";
  }
};

describe("canonical Page history", () => {
  test("merges checkpoints, mutations, and relocations with stable cursors", () => {
    withFixture((fixture) => {
      const card = createCard(fixture, "history-merge-card");
      const relocationSeq = insertRelocation(fixture, card, {
        operationId: "relocate:into-card",
        committedAt: T1,
        withLedger: true,
      });
      const mutationSeq = insertMutation(fixture, card, {
        mutationId: "property:priority",
        committedAt: T2,
      });
      const version = checkpoint(fixture, card, {
        createdAt: T2,
        label: "Before prioritization",
      });

      const first = listPageHistory(fixture.database, {
        ...historyRequest(fixture, card.cardId),
        pageSize: 1,
      });
      expect(first.entries.length).toBe(1);
      expect(first.entries[0]?.kind).toBe("document_version");
      expect(first.nextCursor?.source).toBe("document_version");
      const versionEntry = first.entries[0];
      expect(
        versionEntry?.kind === "document_version" &&
          versionEntry.versionMetadata.versionId === version.versionId,
      ).toBe(true);
      expect(
        versionEntry?.kind === "document_version" &&
          versionEntry.recovery.kind === "restore_document_version",
      ).toBe(true);
      expect(JSON.stringify(versionEntry).length < 3_000).toBe(true);

      if (!first.nextCursor) throw new Error("Missing first cursor");
      const second = listPageHistory(fixture.database, {
        ...historyRequest(fixture, card.cardId),
        before: first.nextCursor,
        pageSize: 1,
      });
      expect(second.entries[0]?.kind).toBe("block_mutation");
      expect(
        second.entries[0]?.kind === "block_mutation" &&
          second.entries[0].changeSeq === mutationSeq,
      ).toBe(true);
      expect(second.entries[0]?.evidence.status).toBe("verified");
      expect(second.nextCursor?.source).toBe("change_log");

      if (!second.nextCursor) throw new Error("Missing second cursor");
      const third = listPageHistory(fixture.database, {
        ...historyRequest(fixture, card.cardId),
        before: second.nextCursor,
        pageSize: 10,
      });
      expect(third.entries[0]?.kind).toBe("block_relocation");
      expect(
        third.entries[0]?.kind === "block_relocation" &&
          third.entries[0].changeSeq === relocationSeq &&
          third.entries[0].direction === "into_page",
      ).toBe(true);
      expect(third.entries[0]?.evidence.status).toBe("verified");
      expect(third.entries[1]?.display.title).toBe("Created Page");
      expect(third.nextCursor).toBe(null);

      const repeatedSecond = listPageHistory(fixture.database, {
        ...historyRequest(fixture, card.cardId),
        before: first.nextCursor,
        pageSize: 1,
      });
      expect(JSON.stringify(repeatedSecond)).toBe(JSON.stringify(second));
    });
  });

  test("projects linked content evidence as one restorable revision", () => {
    withFixture((fixture) => {
      const card = createCard(fixture, "linked-revision");
      const mutationId = "mutation:linked-content";
      const changeSeq = insertMutation(fixture, card, {
        mutationId,
        committedAt: T2,
        mutationKind: "replace_document_from_nfm",
        actor: { displayName: "Agent" },
      });
      const revision = checkpoint(fixture, card, {
        createdAt: T2,
        cause: "replace_document_from_nfm",
        revisionKind: "operation",
        sourceMutationId: mutationId,
        sourceChangeSeq: changeSeq,
        actor: { displayName: "Agent" },
      });

      const page = listPageHistory(fixture.database, {
        ...historyRequest(fixture, card.cardId),
        pageSize: 20,
      });
      const linkedEntries = page.entries.filter(
        (entry) =>
          (entry.kind === "document_version" &&
            entry.versionMetadata.sourceMutationId === mutationId) ||
          (entry.kind === "block_mutation" && entry.mutationId === mutationId),
      );
      expect(linkedEntries).toHaveLength(1);
      expect(linkedEntries[0]).toMatchObject({
        id: `document-version:${revision.versionId}`,
        kind: "document_version",
        display: { category: "content", title: "Edited Page content" },
        recovery: { kind: "restore_document_version" },
        versionMetadata: {
          revisionKind: "operation",
          sourceMutationId: mutationId,
          sourceChangeSeq: changeSeq,
          pinned: false,
        },
      });
    });
  });

  test("requires a recursive grant across Projects and excludes foreign ledger rows", () => {
    withFixture((fixture) => {
      const card = createCard(fixture, "history-scope-card");
      const before = listPageHistory(
        fixture.database,
        historyRequest(fixture, card.cardId),
      );
      insertRelocation(fixture, card, {
        operationId: "foreign:relocation",
        committedAt: T3,
        withLedger: false,
        projectId: "project:foreign",
      });
      const after = listPageHistory(
        fixture.database,
        historyRequest(fixture, card.cardId),
      );
      expect(JSON.stringify(after)).toBe(JSON.stringify(before));
      expect(
        errorCode(() =>
          listPageHistory(fixture.database, {
            version: PAGE_HISTORY_CONTRACT_VERSION,
            requestingProjectId: "project:foreign",
            pageId: card.cardId,
          }),
        ),
      ).toBe("page_not_found");

      fixture.database.prepare(`
        INSERT INTO projects (id, library_id, database_block_id, lifecycle)
        VALUES ('project:foreign', ?, 'database:foreign', 'active')
      `).run(fixture.libraryId);
      fixture.database.prepare(`
        INSERT INTO project_resource_grants (
          id, project_id, library_id, root_kind, root_id, access, recursive,
          revision, lifecycle, created_at, updated_at
        ) VALUES (
          'grant:foreign:page', 'project:foreign', ?, 'page', ?, 'read', 1,
          1, 'active', ?, ?
        )
      `).run(fixture.libraryId, card.cardId, T0, T0);
      const granted = listPageHistory(fixture.database, {
        version: PAGE_HISTORY_CONTRACT_VERSION,
        requestingProjectId: "project:foreign",
        pageId: card.cardId,
      });
      expect(granted.libraryId).toBe(fixture.libraryId);
      expect(granted.entries).toEqual(after.entries);

      fixture.database
        .prepare(
          "INSERT INTO blocks (id, project_id, type) VALUES (?, ?, 'database')",
        )
        .run("database:not-a-card", fixture.projectId);
      expect(
        errorCode(() =>
          listPageHistory(fixture.database, {
            ...historyRequest(fixture, "database:not-a-card"),
          }),
        ),
      ).toBe("page_not_found");
    });
  });

  test("degrades missing, malformed, or oversized evidence without raw JSON", () => {
    withFixture((fixture) => {
      const card = createCard(fixture, "history-malformed-card");
      insertMutation(fixture, card, {
        mutationId: "property:malformed",
        committedAt: T2,
        payloadRequestHash: "f".repeat(64),
      });
      insertMutation(fixture, card, {
        mutationId: "property:oversized-actor",
        committedAt: T3,
        actor: { displayName: "x".repeat(300_000) },
      });
      insertRelocation(fixture, card, {
        operationId: "relocate:missing-ledger",
        committedAt: T4,
        withLedger: false,
      });

      const page = listPageHistory(
        fixture.database,
        historyRequest(fixture, card.cardId),
      );
      expect(page.entries[0]?.kind).toBe("block_relocation");
      expect(page.entries[0]?.evidence.status).toBe("unavailable");
      expect(
        page.entries[0]?.evidence.status === "unavailable" &&
          page.entries[0].evidence.reason === "missing_ledger",
      ).toBe(true);
      expect(page.entries[1]?.display.category).toBe("unknown");
      expect(JSON.stringify(page.entries[1]).length < 2_000).toBe(true);
      expect(
        page.entries[2]?.evidence.status === "unavailable" &&
          page.entries[2].evidence.reason === "malformed_evidence",
      ).toBe(true);
    });
  });

  test("bounds display fields and rejects invalid request or cursor budgets", () => {
    withFixture((fixture) => {
      const card = createCard(fixture, "history-bounds-card");
      checkpoint(fixture, card, {
        createdAt: T3,
        label: "L".repeat(512),
        actor: { displayName: "A".repeat(400) },
      });
      const page = listPageHistory(
        fixture.database,
        historyRequest(fixture, card.cardId),
      );
      const entry = page.entries[0];
      expect(entry?.kind).toBe("document_version");
      expect((entry?.display.detail?.length ?? 0) <= 180).toBe(true);
      expect((entry?.display.actorLabel?.length ?? 0) <= 120).toBe(true);
      expect(
        entry?.kind === "document_version" &&
          entry.versionMetadata.label?.length === 512,
      ).toBe(true);

      expect(
        errorCode(() =>
          listPageHistory(fixture.database, {
            ...historyRequest(fixture, card.cardId),
            pageSize: MAX_PAGE_HISTORY_PAGE_SIZE + 1,
          }),
        ),
      ).toBe("invalid_page_history_request");
      expect(
        errorCode(() =>
          listPageHistory(fixture.database, {
            ...historyRequest(fixture, card.cardId),
            before: {
              source: "change_log",
              changeSeq: 1,
              occurredAt: "not-a-timestamp",
            },
          }),
        ),
      ).toBe("invalid_page_history_request");
      expect(
        errorCode(() =>
          listPageHistory(fixture.database, {
            ...historyRequest(fixture, card.cardId),
            pageId: " ",
          }),
        ),
      ).toBe("invalid_page_history_request");
    });
  });

  test("reads a standalone Page without Database membership", () => {
    withFixture((fixture) => {
      const card = createCard(fixture, "history-standalone-card");
      checkpoint(fixture, card, { createdAt: T2 });
      const memberships = fixture.database
        .prepare(
          `
          SELECT COUNT(*) AS count FROM data_source_page_memberships
          WHERE page_block_id = ? AND removed_at IS NULL
        `,
        )
        .get(card.cardId) as { readonly count: number };
      expect(memberships.count).toBe(0);
      const page = listPageHistory(
        fixture.database,
        historyRequest(fixture, card.cardId),
      );
      expect(page.documentId).toBe(card.documentId);
      expect(page.entries[0]?.kind).toBe("document_version");
      expect(
        page.entries.every(
          (entry: PageHistoryEntry) => entry.pageId === card.cardId,
        ),
      ).toBe(true);
    });
  });
});
