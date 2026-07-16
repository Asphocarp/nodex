import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  BlockPropertyFieldMutation,
  BlockPropertyMutationRequest,
} from "../src/shared/block-property-mutations";
import { createPage } from "../src/main/local-store/database-pages";
import { getDatabasePath } from "../src/main/local-store/config";
import {
  closeDatabase,
  initializeDatabase,
} from "../src/main/local-store/database";
import { createProject } from "../src/main/local-store/projects";
import {
  applyBlockPropertyMutation,
  type BlockPropertyMutationFaultPoint,
} from "../src/main/local-store/block-property-mutations";
import { listBlockChangeHistory } from "../src/main/local-store/document-versions";

interface Fixture {
  readonly database: Database.Database;
  readonly projectId: string;
  readonly cardId: string;
  readonly otherProjectCardId: string;
  readonly detachedCardId: string;
  readonly storeEpoch: string;
  readonly databaseBlockId: string;
  readonly propertyIds: Readonly<Record<string, string>>;
  readonly otherProjectPropertyId: string;
}

interface RevisionValue {
  readonly revision: number;
  readonly value_json: string;
}

const invariant = (condition: boolean, message: string): void => {
  if (condition) return;
  throw new Error(message);
};

const readIntrinsic = (fixture: Fixture, propertyKey: string): RevisionValue =>
  fixture.database
    .prepare(
      `
      SELECT revision, value_json
      FROM block_properties
      WHERE block_id = ? AND project_id = ? AND property_key = ?
    `,
    )
    .get(fixture.cardId, fixture.projectId, propertyKey) as RevisionValue;

const readDatabaseValue = (
  fixture: Fixture,
  propertyKey: string,
): RevisionValue =>
  fixture.database
    .prepare(
      `
      SELECT value.revision, value.value_json
      FROM database_memberships membership
      INNER JOIN database_properties property
        ON property.database_block_id = membership.database_block_id
        AND property.project_id = membership.project_id
        AND property.key = ?
      INNER JOIN database_property_values value
        ON value.membership_id = membership.id
        AND value.property_id = property.id
      WHERE membership.card_block_id = ?
        AND membership.project_id = ?
        AND membership.removed_at IS NULL
    `,
    )
    .get(propertyKey, fixture.cardId, fixture.projectId) as RevisionValue;

const readMetadataRevision = (fixture: Fixture): number =>
  (
    fixture.database
      .prepare(
        "SELECT metadata_revision FROM blocks WHERE id = ? AND project_id = ?",
      )
      .get(fixture.cardId, fixture.projectId) as {
      readonly metadata_revision: number;
    }
  ).metadata_revision;

const readPrimaryViewGroup = (fixture: Fixture): string | null =>
  (
    fixture.database
      .prepare(
        `
        SELECT position.group_key
        FROM database_view_positions position
        INNER JOIN database_views view
          ON view.id = position.view_id
          AND view.project_id = position.project_id
        WHERE position.block_id = ?
          AND position.project_id = ?
          AND view.database_block_id = ?
          AND view.kind = 'kanban'
          AND view.is_primary = 1
      `,
      )
      .get(fixture.cardId, fixture.projectId, fixture.databaseBlockId) as {
      readonly group_key: string | null;
    }
  ).group_key;

const readProjectionSnapshot = (fixture: Fixture): string => {
  const schedule = fixture.database
    .prepare(
      `
      SELECT
        lifecycle, scheduled_start, scheduled_end, is_all_day,
        recurrence_json, reminders_json, schedule_timezone,
        source_metadata_revision
      FROM scheduled_card_index
      WHERE card_block_id = ? AND project_id = ?
    `,
    )
    .get(fixture.cardId, fixture.projectId);
  const readModel = fixture.database
    .prepare(
      `
      SELECT
        metadata_revision, database_values_json, intrinsic_properties_json,
        property_revisions_json
      FROM card_read_model
      WHERE card_block_id = ? AND project_id = ?
    `,
    )
    .get(fixture.cardId, fixture.projectId);
  return JSON.stringify({
    group: readPrimaryViewGroup(fixture),
    schedule: schedule ?? null,
    readModel: readModel ?? null,
  });
};

const requirePropertyId = (fixture: Fixture, key: string): string => {
  const propertyId = fixture.propertyIds[key];
  if (propertyId) return propertyId;
  throw new Error(`Missing Database property ${key}`);
};

const request = (
  fixture: Fixture,
  mutationId: string,
  fields: readonly BlockPropertyFieldMutation[],
): BlockPropertyMutationRequest => ({
  version: 1,
  mutationId,
  projectId: fixture.projectId,
  storeEpoch: fixture.storeEpoch,
  clientSessionId: "runtime-probe",
  actor: { kind: "runtime_probe" },
  fields,
});

const setup = async (): Promise<{
  readonly fixture: Fixture;
  readonly tempDir: string;
}> => {
  closeDatabase();
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "nodex-property-runtime-"),
  );
  process.env.NODEX_DIR = tempDir;
  await initializeDatabase();
  const project = createProject({ name: "Property runtime" });
  const card = await createPage(project.id, "draft", { title: "Mutable" });
  const detached = await createPage(project.id, "draft", {
    title: "Detached membership",
  });
  const otherProject = createProject({ name: "Other Project" });
  const otherCard = await createPage(otherProject.id, "draft", {
    title: "Other",
  });
  closeDatabase();

  const database = new Database(getDatabasePath());
  database.pragma("foreign_keys = ON");
  const store = database
    .prepare("SELECT store_epoch FROM block_store_metadata WHERE id = 1")
    .get() as { readonly store_epoch: string };
  const membership = database
    .prepare(
      `
      SELECT id, database_block_id
      FROM database_memberships
      WHERE card_block_id = ? AND project_id = ? AND removed_at IS NULL
    `,
    )
    .get(card.id, project.id) as {
    readonly id: string;
    readonly database_block_id: string;
  };
  const properties = database
    .prepare(
      `
      SELECT id, key
      FROM database_properties
      WHERE database_block_id = ? AND project_id = ? AND lifecycle = 'active'
    `,
    )
    .all(membership.database_block_id, project.id) as {
    readonly id: string;
    readonly key: string;
  }[];
  const otherProperty = database
    .prepare(
      `
      SELECT property.id
      FROM database_memberships membership
      INNER JOIN database_properties property
        ON property.database_block_id = membership.database_block_id
        AND property.project_id = membership.project_id
        AND property.key = 'priority'
      WHERE membership.card_block_id = ? AND membership.removed_at IS NULL
    `,
    )
    .get(otherCard.id) as { readonly id: string };
  database
    .prepare(
      `
      UPDATE database_memberships
      SET removed_at = ?
      WHERE card_block_id = ? AND project_id = ? AND removed_at IS NULL
    `,
    )
    .run(new Date().toISOString(), detached.id, project.id);
  return {
    fixture: {
      database,
      projectId: project.id,
      cardId: card.id,
      otherProjectCardId: otherCard.id,
      detachedCardId: detached.id,
      storeEpoch: store.store_epoch,
      databaseBlockId: membership.database_block_id,
      propertyIds: Object.fromEntries(
        properties.map((property) => [property.key, property.id]),
      ),
      otherProjectPropertyId: otherProperty.id,
    },
    tempDir,
  };
};

const run = async (): Promise<void> => {
  const { fixture, tempDir } = await setup();
  try {
    const statusBefore = readIntrinsic(fixture, "run.baseBranch");
    const priorityBefore = readDatabaseValue(fixture, "priority");
    const metadataBefore = readMetadataRevision(fixture);
    const batch = request(fixture, "batch", [
      {
        scope: "database",
        pageId: fixture.cardId,
        databaseBlockId: fixture.databaseBlockId,
        propertyId: requirePropertyId(fixture, "priority"),
        operation: "set",
        expectedRevision: priorityBefore.revision,
        value: "p0-critical",
      },
      {
        scope: "intrinsic",
        blockId: fixture.cardId,
        propertyKey: "run.baseBranch",
        operation: "set",
        expectedRevision: statusBefore.revision,
        value: "running",
      },
    ]);
    const committed = applyBlockPropertyMutation(fixture.database, batch);
    invariant(committed.ok, "mixed property batch did not commit");
    if (!committed.ok) throw new Error(committed.error.message);
    invariant(
      readMetadataRevision(fixture) === metadataBefore + 1,
      "Card metadata revision did not advance exactly once for a batch",
    );
    const duplicate = applyBlockPropertyMutation(fixture.database, batch);
    invariant(
      duplicate.ok && duplicate.value.duplicate,
      "exact retry did not return the durable receipt",
    );
    invariant(
      readIntrinsic(fixture, "run.baseBranch").revision ===
        statusBefore.revision + 1,
      "exact retry re-applied an intrinsic scalar",
    );

    const databaseStatusBefore = readDatabaseValue(fixture, "status");
    const statusMutation = applyBlockPropertyMutation(
      fixture.database,
      request(fixture, "status-group", [
        {
          scope: "database",
          pageId: fixture.cardId,
          databaseBlockId: fixture.databaseBlockId,
          propertyId: requirePropertyId(fixture, "status"),
          operation: "set",
          expectedRevision: databaseStatusBefore.revision,
          value: "in_progress",
        },
      ]),
    );
    invariant(statusMutation.ok, "status property did not commit");
    invariant(
      readPrimaryViewGroup(fixture) === "in_progress",
      "status property and primary View group diverged",
    );
    const invalidStatus = applyBlockPropertyMutation(
      fixture.database,
      request(fixture, "invalid-status", [
        {
          scope: "database",
          pageId: fixture.cardId,
          databaseBlockId: fixture.databaseBlockId,
          propertyId: requirePropertyId(fixture, "status"),
          operation: "set",
          expectedRevision: databaseStatusBefore.revision + 1,
          value: "not-a-defined-option",
        },
      ]),
    );
    invariant(
      !invalidStatus.ok &&
        invalidStatus.error.code === "property_value_invalid" &&
        readPrimaryViewGroup(fixture) === "in_progress",
      "invalid select value changed status or View grouping",
    );

    const invalidIntrinsic = applyBlockPropertyMutation(
      fixture.database,
      request(fixture, "invalid-run-target", [
        {
          scope: "intrinsic",
          blockId: fixture.cardId,
          propertyKey: "run.target",
          operation: "set",
          expectedRevision: readIntrinsic(fixture, "run.target").revision,
          value: "somewhere",
        },
      ]),
    );
    invariant(
      !invalidIntrinsic.ok &&
        invalidIntrinsic.error.code === "property_value_invalid",
      "typed intrinsic property accepted an invalid value",
    );
    const dueDateBefore = readDatabaseValue(fixture, "due_date");
    const invalidDate = applyBlockPropertyMutation(
      fixture.database,
      request(fixture, "invalid-date", [
        {
          scope: "database",
          pageId: fixture.cardId,
          databaseBlockId: fixture.databaseBlockId,
          propertyId: requirePropertyId(fixture, "due_date"),
          operation: "set",
          expectedRevision: dueDateBefore.revision,
          value: "2026-02-30",
        },
      ]),
    );
    invariant(
      !invalidDate.ok && invalidDate.error.code === "property_value_invalid",
      "typed date property accepted a non-existent calendar date",
    );
    let statusFaulted = false;
    try {
      applyBlockPropertyMutation(
        fixture.database,
        request(fixture, "status-group-fault", [
          {
            scope: "database",
            pageId: fixture.cardId,
            databaseBlockId: fixture.databaseBlockId,
            propertyId: requirePropertyId(fixture, "status"),
            operation: "set",
            expectedRevision: databaseStatusBefore.revision + 1,
            value: "done",
          },
        ]),
        {
          faultInjector: (point) => {
            if (point !== "after_property_values") return;
            throw new Error("fault:status-group");
          },
        },
      );
    } catch {
      statusFaulted = true;
    }
    invariant(
      statusFaulted &&
        JSON.parse(readDatabaseValue(fixture, "status").value_json) ===
          "in_progress" &&
        readPrimaryViewGroup(fixture) === "in_progress",
      "status property/View group fault did not roll back atomically",
    );

    const allDayBefore = readIntrinsic(fixture, "schedule.isAllDay");
    const invalidAllDay = applyBlockPropertyMutation(
      fixture.database,
      request(fixture, "all-day-without-range", [
        {
          scope: "intrinsic",
          blockId: fixture.cardId,
          propertyKey: "schedule.isAllDay",
          operation: "set",
          expectedRevision: allDayBefore.revision,
          value: true,
        },
      ]),
    );
    invariant(
      !invalidAllDay.ok &&
        invalidAllDay.error.code === "property_value_invalid" &&
        readIntrinsic(fixture, "schedule.isAllDay").revision ===
          allDayBefore.revision,
      "all-day schedule without a range was not rejected before writes",
    );
    const startBefore = readDatabaseValue(fixture, "scheduled_start");
    const endBefore = readDatabaseValue(fixture, "scheduled_end");
    const scheduleBatch = applyBlockPropertyMutation(
      fixture.database,
      request(fixture, "all-day-range", [
        {
          scope: "database",
          pageId: fixture.cardId,
          databaseBlockId: fixture.databaseBlockId,
          propertyId: requirePropertyId(fixture, "scheduled_start"),
          operation: "set",
          expectedRevision: startBefore.revision,
          value: "2026-07-12T00:00:00.000Z",
        },
        {
          scope: "database",
          pageId: fixture.cardId,
          databaseBlockId: fixture.databaseBlockId,
          propertyId: requirePropertyId(fixture, "scheduled_end"),
          operation: "set",
          expectedRevision: endBefore.revision,
          value: "2026-07-13T00:00:00.000Z",
        },
        {
          scope: "intrinsic",
          blockId: fixture.cardId,
          propertyKey: "schedule.isAllDay",
          operation: "set",
          expectedRevision: allDayBefore.revision,
          value: true,
        },
      ]),
    );
    invariant(scheduleBatch.ok, "valid all-day schedule batch did not commit");
    const scheduleIndex = fixture.database
      .prepare(
        `
        SELECT
          scheduled_start, scheduled_end, is_all_day,
          source_metadata_revision
        FROM scheduled_card_index
        WHERE card_block_id = ? AND project_id = ?
      `,
      )
      .get(fixture.cardId, fixture.projectId) as {
      readonly scheduled_start: string;
      readonly scheduled_end: string;
      readonly is_all_day: number;
      readonly source_metadata_revision: number;
    };
    invariant(
      scheduleIndex.scheduled_start === "2026-07-12T00:00:00.000Z" &&
        scheduleIndex.scheduled_end === "2026-07-13T00:00:00.000Z" &&
        scheduleIndex.is_all_day === 1 &&
        scheduleIndex.source_metadata_revision ===
          readMetadataRevision(fixture),
      "schedule index did not commit the current metadata coordinate",
    );

    const projectionFaultBefore = readProjectionSnapshot(fixture);
    const projectionFaultMetadata = readMetadataRevision(fixture);
    let projectionFaulted = false;
    try {
      applyBlockPropertyMutation(
        fixture.database,
        request(fixture, "after-projections-fault", [
          {
            scope: "database",
            pageId: fixture.cardId,
            databaseBlockId: fixture.databaseBlockId,
            propertyId: requirePropertyId(fixture, "status"),
            operation: "set",
            expectedRevision: databaseStatusBefore.revision + 1,
            value: "done",
          },
        ]),
        {
          faultInjector: (point) => {
            if (point !== "after_projections") return;
            throw new Error("fault:after_projections");
          },
        },
      );
    } catch {
      projectionFaulted = true;
    }
    const projectionFaultLedger = fixture.database
      .prepare(
        "SELECT COUNT(*) AS count FROM block_mutations WHERE mutation_id = ?",
      )
      .get("after-projections-fault") as { readonly count: number };
    invariant(
      projectionFaulted &&
        JSON.parse(readDatabaseValue(fixture, "status").value_json) ===
          "in_progress" &&
        readMetadataRevision(fixture) === projectionFaultMetadata &&
        readProjectionSnapshot(fixture) === projectionFaultBefore &&
        projectionFaultLedger.count === 0,
      "after_projections fault leaked value, View, index, read model, or ledger",
    );

    const targetBefore = readIntrinsic(fixture, "run.target");
    const independent = applyBlockPropertyMutation(
      fixture.database,
      request(fixture, "independent", [
        {
          scope: "intrinsic",
          blockId: fixture.cardId,
          propertyKey: "run.target",
          operation: "set",
          expectedRevision: targetBefore.revision,
          value: "newWorktree",
        },
      ]),
    );
    invariant(independent.ok, "independent field was coupled to Card revision");
    const staleRequest = request(fixture, "stale", [
      {
        scope: "intrinsic",
        blockId: fixture.cardId,
        propertyKey: "run.baseBranch",
        operation: "set",
        expectedRevision: statusBefore.revision,
        value: "blocked",
      },
    ]);
    const stale = applyBlockPropertyMutation(fixture.database, staleRequest);
    invariant(
      !stale.ok && stale.error.code === "property_conflict",
      "stale scalar did not return property_conflict",
    );
    const staleRetry = applyBlockPropertyMutation(
      fixture.database,
      staleRequest,
    );
    invariant(
      !staleRetry.ok && staleRetry.error.code === "property_conflict",
      "rejected mutation receipt was not idempotent",
    );

    const tagsBefore = readDatabaseValue(fixture, "tags");
    const tags = request(fixture, "tags", [
      {
        scope: "database",
        pageId: fixture.cardId,
        databaseBlockId: fixture.databaseBlockId,
        propertyId: requirePropertyId(fixture, "tags"),
        operation: "add_remove",
        add: ["zeta", "alpha", "alpha"],
        remove: ["missing"],
      },
    ]);
    invariant(
      applyBlockPropertyMutation(fixture.database, tags).ok,
      "tag intent did not commit",
    );
    invariant(
      readDatabaseValue(fixture, "tags").value_json ===
        JSON.stringify(["alpha", "zeta"]),
      "tag intent did not persist a deterministic set",
    );
    invariant(
      applyBlockPropertyMutation(fixture.database, tags).ok &&
        readDatabaseValue(fixture, "tags").revision === tagsBefore.revision + 1,
      "tag retry was not idempotent",
    );

    const crossProject = applyBlockPropertyMutation(
      fixture.database,
      request(fixture, "cross-project", [
        {
          scope: "intrinsic",
          blockId: fixture.otherProjectCardId,
          propertyKey: "run.baseBranch",
          operation: "set",
          expectedRevision: 1,
          value: "must-not-write",
        },
      ]),
    );
    invariant(
      !crossProject.ok && crossProject.error.code === "block_not_found",
      "Project scope was not enforced",
    );
    const missingMembership = applyBlockPropertyMutation(
      fixture.database,
      request(fixture, "missing-membership", [
        {
          scope: "database",
          pageId: fixture.detachedCardId,
          databaseBlockId: fixture.databaseBlockId,
          propertyId: requirePropertyId(fixture, "priority"),
          operation: "set",
          expectedRevision: 1,
          value: "p0-critical",
        },
      ]),
    );
    invariant(
      !missingMembership.ok &&
        missingMembership.error.code === "membership_not_found",
      "active membership scope was not enforced",
    );
    const foreignProperty = applyBlockPropertyMutation(
      fixture.database,
      request(fixture, "foreign-property", [
        {
          scope: "database",
          pageId: fixture.cardId,
          databaseBlockId: fixture.databaseBlockId,
          propertyId: fixture.otherProjectPropertyId,
          operation: "set",
          expectedRevision: 1,
          value: "p0-critical",
        },
      ]),
    );
    invariant(
      !foreignProperty.ok &&
        foreignProperty.error.code === "property_not_found",
      "Database property scope was not enforced",
    );

    const faultPoints: readonly BlockPropertyMutationFaultPoint[] = [
      "after_property_values",
      "after_block_metadata",
      "after_projections",
      "after_change_log",
      "after_ledger",
      "before_commit",
    ];
    const faultBaseline = readIntrinsic(fixture, "run.baseBranch");
    const faultMetadata = readMetadataRevision(fixture);
    for (const point of faultPoints) {
      let failed = false;
      try {
        applyBlockPropertyMutation(
          fixture.database,
          request(fixture, `fault-${point}`, [
            {
              scope: "intrinsic",
              blockId: fixture.cardId,
              propertyKey: "run.baseBranch",
              operation: "set",
              expectedRevision: faultBaseline.revision,
              value: point,
            },
          ]),
          {
            faultInjector: (current) => {
              if (current !== point) return;
              throw new Error(`fault:${point}`);
            },
          },
        );
      } catch {
        failed = true;
      }
      invariant(failed, `fault point did not throw: ${point}`);
      invariant(
        readIntrinsic(fixture, "run.baseBranch").value_json ===
          faultBaseline.value_json &&
          readIntrinsic(fixture, "run.baseBranch").revision ===
            faultBaseline.revision &&
          readMetadataRevision(fixture) === faultMetadata,
        `fault point leaked authoritative writes: ${point}`,
      );
      const ledger = fixture.database
        .prepare(
          "SELECT COUNT(*) AS count FROM block_mutations WHERE mutation_id = ?",
        )
        .get(`fault-${point}`) as { readonly count: number };
      invariant(ledger.count === 0, `fault point leaked a receipt: ${point}`);
    }

    const changeCount = fixture.database
      .prepare(
        `
        SELECT COUNT(*) AS count
        FROM change_log
        WHERE project_id = ? AND kind = 'block_mutation'
      `,
      )
      .get(fixture.projectId) as { readonly count: number };
    const history = listBlockChangeHistory(fixture.database, {
      projectId: fixture.projectId,
      blockId: fixture.cardId,
      limit: 200,
    });
    const propertyHistory = history.find(
      (entry) => entry.operationId === batch.mutationId,
    );
    invariant(
      propertyHistory?.mutationKind === "property_batch" &&
        Array.isArray(propertyHistory.payload.fieldChanges) &&
        propertyHistory.payload.fieldChanges.length === batch.fields.length,
      "Property mutation was not visible with field-level history evidence",
    );
    fixture.database.close();
    const reopened = new Database(getDatabasePath());
    reopened.pragma("foreign_keys = ON");
    const restartDuplicate = applyBlockPropertyMutation(reopened, batch);
    invariant(
      restartDuplicate.ok && restartDuplicate.value.duplicate,
      "durable mutation receipt did not survive restart",
    );
    reopened.close();

    process.stdout.write(
      `${JSON.stringify({
        atomicBatch: true,
        exactRetry: true,
        fieldLevelCas: true,
        tagIntent: true,
        typedValues: true,
        statusViewAtomic: true,
        scheduleProjectionAtomic: true,
        projectionFaultRollback: true,
        scoped: true,
        preCommitFaults: faultPoints.length,
        durableRestart: true,
        changeLogEntries: changeCount.count,
        canonicalPropertyHistory: true,
      })}\n`,
    );
  } finally {
    if (fixture.database.open) fixture.database.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
    delete process.env.NODEX_DIR;
    closeDatabase();
  }
};

void run().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack : String(error)}\n`,
  );
  process.exitCode = 1;
});
