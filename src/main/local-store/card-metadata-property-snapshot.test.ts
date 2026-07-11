import { describe, expect, test } from "vitest";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { compileCardMetadataPropertyMutation } from "../../shared/card-metadata-property-compiler";
import { parseCardLifecycleMutationRequest } from "../../shared/card-lifecycle";
import { applyCardLifecycleMutation } from "./card-block-lifecycle";
import { applyBlockPropertyMutation } from "./block-property-mutations";
import {
  closeDatabase,
  getDb,
  initializeDatabase,
} from "./database";
import { createProject } from "./projects";
import {
  CardMetadataPropertySnapshotError,
  readCardMetadataPropertySnapshot,
} from "./card-metadata-property-snapshot";

const isUnsupportedSqliteError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("better-sqlite3") && message.includes("not yet supported");
};

const supportsBetterSqlite = (() => {
  try {
    const database = new Database(":memory:");
    database.close();
    return true;
  } catch (error) {
    if (isUnsupportedSqliteError(error)) return false;
    throw error;
  }
})();

const skipTest = (test as typeof test & { skip: typeof test }).skip;
const sqliteTest = supportsBetterSqlite ? test : skipTest;

interface Fixture {
  readonly directory: string;
  readonly projectId: string;
  readonly otherProjectId: string;
  readonly cardId: string;
}

const withFixture = async (
  run: (fixture: Fixture) => Promise<void> | void,
): Promise<void> => {
  closeDatabase();
  const previousDirectory = process.env.NODEX_DIR;
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "nodex-card-metadata-compiler-"),
  );
  process.env.NODEX_DIR = directory;
  try {
    await initializeDatabase();
    const project = createProject({ name: "Metadata compiler" });
    const otherProject = createProject({ name: "Other scope" });
    const database = getDb();
    const store = database
      .prepare("SELECT store_epoch FROM block_store_metadata WHERE id = 1")
      .get() as { readonly store_epoch: string };
    const cardId = "metadata-compiler-card";
    const created = applyCardLifecycleMutation(
      database,
      parseCardLifecycleMutationRequest({
        version: 1,
        operationId: "metadata:create",
        projectId: project.id,
        storeEpoch: store.store_epoch,
        actor: { kind: "test" },
        operation: {
          kind: "create_card",
          cardId,
          title: "Metadata Card",
          nfm: "Body remains in its Document",
          status: "draft",
        },
      }),
      { allocateBodyBlockId: () => "metadata-body" },
    );
    if (!created.ok) throw new Error(created.error.message);
    await run({
      directory,
      projectId: project.id,
      otherProjectId: otherProject.id,
      cardId,
    });
  } finally {
    closeDatabase();
    fs.rmSync(directory, { recursive: true, force: true });
    if (previousDirectory === undefined) {
      delete process.env.NODEX_DIR;
    } else {
      process.env.NODEX_DIR = previousDirectory;
    }
  }
};

const compile = (
  fixture: Fixture,
  mutationId: string,
  patch: Parameters<typeof compileCardMetadataPropertyMutation>[0]["patch"],
) =>
  compileCardMetadataPropertyMutation({
    mutationId,
    clientSessionId: "metadata-test-window",
    actor: { kind: "test" },
    snapshot: readCardMetadataPropertySnapshot(
      getDb(),
      fixture.projectId,
      fixture.cardId,
    ),
    patch,
  });

const fieldValue = (
  fixture: Fixture,
  field: string,
): { readonly revision: number; readonly value: unknown } => {
  const coordinate = readCardMetadataPropertySnapshot(
    getDb(),
    fixture.projectId,
    fixture.cardId,
  ).fields.find((candidate) => candidate.field === field);
  if (!coordinate) throw new Error(`Missing Card metadata field ${field}`);
  return { revision: coordinate.revision, value: coordinate.value };
};

describe("Card metadata compatibility snapshot/compiler", () => {
  sqliteTest(
    "reads every relational field and commits one existing property receipt",
    async () => {
      await withFixture((fixture) => {
        const database = getDb();
        const snapshot = readCardMetadataPropertySnapshot(
          database,
          fixture.projectId,
          fixture.cardId,
        );
        expect(snapshot.fields.length).toBe(19);
        expect(snapshot.metadataRevision).toBe(1);
        expect(
          database
            .prepare(
              "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'cards'",
            )
            .get() === undefined,
        ).toBe(true);

        const request = compileCardMetadataPropertyMutation({
          mutationId: "metadata:mixed",
          clientSessionId: "metadata-test-window",
          actor: { kind: "test" },
          snapshot,
          patch: {
            priority: "p0-critical",
            agentStatus: "running",
          },
        });
        const committed = applyBlockPropertyMutation(database, request);
        expect(committed.ok).toBe(true);
        expect(fieldValue(fixture, "priority").value).toBe("p0-critical");
        expect(fieldValue(fixture, "agentStatus").value).toBe("running");
        const replay = applyBlockPropertyMutation(database, request);
        expect(replay.ok).toBe(true);
        expect(replay.ok ? replay.value.duplicate : false).toBe(true);
      });
    },
  );

  sqliteTest(
    "merges independent fields and tag intents while stale scalar CAS fails",
    async () => {
      await withFixture((fixture) => {
        getDb()
          .prepare(
            `
            UPDATE database_properties
            SET config_json = ?
            WHERE project_id = ? AND key = 'tags' AND lifecycle = 'active'
          `,
          )
          .run(
            JSON.stringify({
              options: [
                { id: "alpha", name: "Alpha" },
                { id: "beta", name: "Beta" },
              ],
            }),
            fixture.projectId,
          );
        const initial = readCardMetadataPropertySnapshot(
          getDb(),
          fixture.projectId,
          fixture.cardId,
        );
        const request = (
          mutationId: string,
          patch: Parameters<typeof compileCardMetadataPropertyMutation>[0]["patch"],
        ) =>
          compileCardMetadataPropertyMutation({
            mutationId,
            actor: { kind: "test" },
            snapshot: initial,
            patch,
          });
        const priority = request("metadata:priority", {
          priority: "p0-critical",
        });
        const estimate = request("metadata:estimate", { estimate: "l" });
        const stalePriority = request("metadata:priority-stale", {
          priority: "p1-high",
        });
        const tagsAlpha = request("metadata:tags-alpha", { tags: ["alpha"] });
        const tagsBeta = request("metadata:tags-beta", { tags: ["beta"] });

        expect(applyBlockPropertyMutation(getDb(), priority).ok).toBe(true);
        expect(applyBlockPropertyMutation(getDb(), estimate).ok).toBe(true);
        const conflict = applyBlockPropertyMutation(getDb(), stalePriority);
        expect(conflict.ok).toBe(false);
        expect(conflict.ok ? "ok" : conflict.error.code).toBe(
          "property_conflict",
        );
        expect(applyBlockPropertyMutation(getDb(), tagsAlpha).ok).toBe(true);
        expect(applyBlockPropertyMutation(getDb(), tagsBeta).ok).toBe(true);
        expect(fieldValue(fixture, "priority").value).toBe("p0-critical");
        expect(fieldValue(fixture, "estimate").value).toBe("l");
        expect(JSON.stringify(fieldValue(fixture, "tags").value)).toBe(
          JSON.stringify(["alpha", "beta"]),
        );
      });
    },
  );

  sqliteTest(
    "rolls compiled batches back on fault and enforces Project scope",
    async () => {
      await withFixture((fixture) => {
        const priorityBefore = fieldValue(fixture, "priority");
        const agentBefore = fieldValue(fixture, "agentStatus");
        const request = compile(fixture, "metadata:fault", {
          priority: "p0-critical",
          agentStatus: "running",
        });
        let faulted = false;
        try {
          applyBlockPropertyMutation(getDb(), request, {
            faultInjector: (point) => {
              if (point !== "after_property_values") return;
              throw new Error("fault:metadata-values");
            },
          });
        } catch {
          faulted = true;
        }
        expect(faulted).toBe(true);
        expect(fieldValue(fixture, "priority").revision).toBe(
          priorityBefore.revision,
        );
        expect(fieldValue(fixture, "agentStatus").revision).toBe(
          agentBefore.revision,
        );
        const leakedReceipt = getDb()
          .prepare(
            "SELECT COUNT(*) AS count FROM block_mutations WHERE mutation_id = ?",
          )
          .get(request.mutationId) as { readonly count: number };
        expect(leakedReceipt.count).toBe(0);

        let scopeError: string | null = null;
        try {
          readCardMetadataPropertySnapshot(
            getDb(),
            fixture.otherProjectId,
            fixture.cardId,
          );
        } catch (error) {
          scopeError =
            error instanceof CardMetadataPropertySnapshotError
              ? error.code
              : "unexpected";
        }
        expect(scopeError).toBe("card_not_found");
      });
    },
  );

  sqliteTest(
    "represents sparse Database values at revision zero",
    async () => {
      await withFixture((fixture) => {
        const database = getDb();
        database
          .prepare(
            `
            DELETE FROM database_property_values
            WHERE membership_id = (
              SELECT id
              FROM database_memberships
              WHERE card_block_id = ? AND project_id = ? AND removed_at IS NULL
            )
              AND property_id IN (
                SELECT id
                FROM database_properties
                WHERE project_id = ? AND key IN ('priority', 'tags')
              )
          `,
          )
          .run(fixture.cardId, fixture.projectId, fixture.projectId);

        const snapshot = readCardMetadataPropertySnapshot(
          database,
          fixture.projectId,
          fixture.cardId,
        );
        const priority = snapshot.fields.find(
          (field) => field.field === "priority",
        );
        const tags = snapshot.fields.find((field) => field.field === "tags");
        expect(priority?.revision).toBe(0);
        expect(priority?.value).toBe(null);
        expect(tags?.revision).toBe(0);
        expect(JSON.stringify(tags?.value)).toBe("[]");

        const request = compileCardMetadataPropertyMutation({
          mutationId: "metadata:sparse-values",
          actor: { kind: "test" },
          snapshot,
          patch: { priority: "p1-high", tags: ["existing-option"] },
        });
        expect(request.fields.length).toBe(2);
        const priorityIntent = request.fields.find(
          (field) => field.operation === "set",
        );
        expect(
          priorityIntent?.operation === "set"
            ? priorityIntent.expectedRevision
            : -1,
        ).toBe(0);
        const tagIntent = request.fields.find(
          (field) => field.operation === "add_remove",
        );
        expect(
          tagIntent?.operation === "add_remove"
            ? tagIntent.add.join(",")
            : "",
        ).toBe("existing-option");
      });
    },
  );

  sqliteTest(
    "omits absent Database definitions without blocking intrinsic metadata",
    async () => {
      await withFixture((fixture) => {
        const database = getDb();
        database
          .prepare(
            `
            UPDATE database_properties
            SET lifecycle = 'deleted'
            WHERE database_block_id = (
              SELECT database_block_id
              FROM database_memberships
              WHERE card_block_id = ? AND project_id = ? AND removed_at IS NULL
            )
              AND project_id = ?
          `,
          )
          .run(fixture.cardId, fixture.projectId, fixture.projectId);

        const snapshot = readCardMetadataPropertySnapshot(
          database,
          fixture.projectId,
          fixture.cardId,
        );
        expect(snapshot.fields.length).toBe(11);
        const request = compileCardMetadataPropertyMutation({
          mutationId: "metadata:custom-database-intrinsic",
          actor: { kind: "test" },
          snapshot,
          patch: { agentStatus: "running" },
        });
        expect(request.fields.length).toBe(1);
        expect(request.fields[0]?.scope).toBe("intrinsic");

        let missing: string | null = null;
        try {
          compileCardMetadataPropertyMutation({
            mutationId: "metadata:custom-database-missing",
            actor: { kind: "test" },
            snapshot,
            patch: { priority: "p1-high" },
          });
        } catch (error) {
          missing = error instanceof Error ? error.message : "unexpected";
        }
        expect(missing).toBe("Card metadata snapshot is missing priority");
      });
    },
  );
});
