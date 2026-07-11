import { describe, expect, test } from "vitest";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { materializeCardDocument } from "../../shared/block-documents/block-document-codec";
import { createCard } from "./cards";
import { loadBlockDocument } from "./block-document-store";
import { getDatabasePath } from "./config";
import { closeDatabase, initializeDatabase } from "./database";
import {
  drainLegacyCardShadowJobs,
  runLegacyCardShadowProcessorProbe,
} from "./legacy-card-shadow-processor";
import { createProject } from "./projects";
import { claimNextLegacyCardShadowJob } from "./legacy-card-shadow-outbox";

const supportsBetterSqlite3 = (): boolean => {
  try {
    const database = new Database(":memory:");
    database.close();
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("better-sqlite3") && message.includes("not yet supported")) {
      return false;
    }
    throw error;
  }
};

const skipTest = (test as typeof test & { skip: typeof test }).skip;
const sqliteTest = supportsBetterSqlite3() ? test : skipTest;

const withDatabase = async (
  name: string,
  run: (database: Database.Database) => void | Promise<void>,
): Promise<void> => {
  closeDatabase();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `nodex-${name}-`));
  process.env.NODEX_DIR = tempDir;
  try {
    await initializeDatabase();
    closeDatabase();
    const database = new Database(getDatabasePath());
    database.pragma("foreign_keys = ON");
    try {
      await run(database);
    } finally {
      database.close();
    }
  } finally {
    closeDatabase();
    fs.rmSync(tempDir, { recursive: true, force: true });
    delete process.env.NODEX_DIR;
  }
};

const flattenIds = (
  blocks: readonly { readonly id: string; readonly children: readonly unknown[] }[],
): readonly string[] =>
  blocks.flatMap((block) => [
    block.id,
    ...flattenIds(
      block.children as readonly {
        readonly id: string;
        readonly children: readonly unknown[];
      }[],
    ),
  ]);

const materializePersistedCard = (
  database: Database.Database,
  cardId: string,
) => {
  const loaded = loadBlockDocument(database, `document:${cardId}`);
  try {
    return {
      headSeq: loaded.head.headSeq,
      materialization: materializeCardDocument(loaded.document),
    };
  } finally {
    loaded.document.destroy();
  }
};

describe("legacy Card shadow processor", () => {
  sqliteTest("reports an outstanding processing lease at the exact drain limit", async () => {
    await withDatabase("shadow-processor-limit", async (database) => {
      const project = createProject({ name: "Shadow limit" });
      await createCard(project.id, "draft", { title: "First" });
      await createCard(project.id, "draft", { title: "Second" });
      const leased = claimNextLegacyCardShadowJob(database, {
        claimToken: "held-processing-lease",
        leaseMs: 60_000,
      });
      if (!leased) throw new Error("Expected one processing lease");

      const drain = drainLegacyCardShadowJobs(database, {
        maxJobs: 1,
        createClaimToken: () => "limit-claim",
      });
      expect(drain.results.length).toBe(1);
      expect(drain.exhausted).toBe(false);
    });
  });

  sqliteTest("supersedes stale snapshots and advances one stable-ID Y.Doc", async () => {
    await withDatabase("shadow-processor", async (database) => {
      const project = createProject({ name: "Shadow processor" });
      const card = await createCard(project.id, "draft", {
        title: "Initial",
        description: "Alpha\nBeta",
      });

      database.prepare(`
        UPDATE cards
        SET title = ?, description = ?, revision = revision + 1
        WHERE id = ?
      `).run("Intermediate", "Alpha revised\nBeta", card.id);
      database.prepare(`
        UPDATE cards
        SET title = ?, description = ?, revision = revision + 1
        WHERE id = ?
      `).run("Genesis winner", "Alpha revised\nBeta\nGamma", card.id);

      const genesisDrain = drainLegacyCardShadowJobs(database, {
        maxJobs: 10,
        createClaimToken: (index) => `genesis-claim-${index}`,
      });
      expect(genesisDrain.results.map((result) => result.outcome).join(",")).toBe(
        "superseded,superseded,applied",
      );
      const genesis = materializePersistedCard(database, card.id);
      expect(genesis.headSeq).toBe(1);
      expect(genesis.materialization.title).toBe("Genesis winner");
      expect(genesis.materialization.nfm).toBe("Alpha revised\nBeta\nGamma");
      const genesisIds = flattenIds(genesis.materialization.blockTree);

      database.prepare(`
        UPDATE cards
        SET title = ?, description = ?, revision = revision + 1
        WHERE id = ?
      `).run("Translated", "Alpha final\nBeta\nGamma\nDelta", card.id);
      const translation = drainLegacyCardShadowJobs(database, {
        maxJobs: 1,
        createClaimToken: () => "translation-claim",
      });
      expect(translation.results[0]?.outcome).toBe("applied");
      expect(translation.results[0]?.documentChanged).toBe(true);
      const translated = materializePersistedCard(database, card.id);
      expect(translated.headSeq).toBe(2);
      expect(translated.materialization.title).toBe("Translated");
      const translatedIds = flattenIds(translated.materialization.blockTree);
      expect(translatedIds.slice(0, 3).join(",")).toBe(genesisIds.join(","));
      expect(new Set(translatedIds).size).toBe(translatedIds.length);

      database.prepare(`
        UPDATE cards SET status = 'backlog', revision = revision + 1 WHERE id = ?
      `).run(card.id);
      const metadataOnly = drainLegacyCardShadowJobs(database, {
        maxJobs: 1,
        createClaimToken: () => "metadata-claim",
      });
      expect(metadataOnly.results.length).toBe(0);
      expect(metadataOnly.exhausted).toBe(true);
      expect(materializePersistedCard(database, card.id).headSeq).toBe(2);

      database.prepare(`
        UPDATE cards
        SET archived = 1, title = 'Archived translation', revision = revision + 1
        WHERE id = ?
      `).run(card.id);
      const archived = drainLegacyCardShadowJobs(database, {
        maxJobs: 1,
        createClaimToken: () => "archived-claim",
      });
      expect(archived.results[0]?.outcome).toBe("applied");
      expect(archived.results[0]?.documentChanged).toBe(true);
      expect(materializePersistedCard(database, card.id).materialization.title).toBe(
        "Archived translation",
      );

      database.prepare("DELETE FROM cards WHERE id = ?").run(card.id);
      const deleted = drainLegacyCardShadowJobs(database, {
        maxJobs: 1,
        createClaimToken: () => "delete-claim",
      });
      expect(deleted.results[0]?.outcome).toBe("applied");
      expect(deleted.results[0]?.documentChanged).toBe(false);
      const tombstone = database.prepare(`
        SELECT lifecycle FROM blocks WHERE id = ?
      `).get(card.id) as { readonly lifecycle: string };
      expect(tombstone.lifecycle).toBe("deleted");
    });
  });

  sqliteTest("rolls back the Document before terminally failing a claimed job", async () => {
    await withDatabase("shadow-processor-rollback", async (database) => {
      const project = createProject({ name: "Shadow rollback" });
      const card = await createCard(project.id, "draft", {
        title: "Atomic",
        description: "Never half commit",
      });
      database.exec(`
        CREATE TRIGGER reject_shadow_materialization
        BEFORE INSERT ON document_materializations
        BEGIN
          SELECT RAISE(ABORT, 'injected materialization failure');
        END;
      `);

      const drain = drainLegacyCardShadowJobs(database, {
        maxJobs: 1,
        createClaimToken: () => "rollback-claim",
      });
      expect(drain.results[0]?.outcome).toBe("failed");
      expect(drain.results[0]?.error?.includes("injected materialization failure")).toBe(true);
      const document = database.prepare(`
        SELECT head_seq, readiness FROM documents WHERE id = ?
      `).get(`document:${card.id}`) as {
        readonly head_seq: number;
        readonly readiness: string;
      };
      expect(document.head_seq).toBe(0);
      expect(document.readiness).toBe("pending_genesis");
      const durableUpdates = database.prepare(`
        SELECT COUNT(*) AS count FROM document_updates WHERE document_id = ?
      `).get(`document:${card.id}`) as { readonly count: number };
      expect(durableUpdates.count).toBe(0);
      const job = database.prepare(`
        SELECT status, last_error FROM legacy_card_shadow_jobs WHERE card_id = ?
      `).get(card.id) as { readonly status: string; readonly last_error: string };
      expect(job.status).toBe("failed");
      expect(job.last_error.includes("injected materialization failure")).toBe(true);
    });
  });

  sqliteTest("fails closed when a claimed legacy job encounters primary authority", async () => {
    await withDatabase("shadow-processor-authority", async (database) => {
      const project = createProject({ name: "Shadow authority" });
      const card = await createCard(project.id, "draft", {
        title: "Legacy",
        description: "Body",
      });
      const initial = runLegacyCardShadowProcessorProbe(database);
      expect(initial.allCurrentCardsReady).toBe(true);
      expect(initial.allCurrentCardContentInParity).toBe(true);

      database.prepare(`
        UPDATE cards SET title = 'Pending legacy', revision = revision + 1 WHERE id = ?
      `).run(card.id);
      database.prepare(`
        UPDATE documents SET authority = 'ydoc_primary' WHERE id = ?
      `).run(`document:${card.id}`);
      const headBefore = materializePersistedCard(database, card.id);
      const drain = drainLegacyCardShadowJobs(database, {
        maxJobs: 1,
        createClaimToken: () => "authority-claim",
      });
      expect(drain.results[0]?.outcome).toBe("failed");
      expect(drain.results[0]?.error?.includes("authority ydoc_primary")).toBe(true);
      expect(materializePersistedCard(database, card.id).headSeq).toBe(
        headBefore.headSeq,
      );
    });
  });
});
