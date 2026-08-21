import { describe, expect, test } from "vite-plus/test";
import {
  CODEX_OWNER_METADATA_MIGRATION_CUTOFF_MS,
  CODEX_OWNERLESS_WORKTREE_GRACE_MS,
  planManagedWorktreeRetention,
  type CodexManagedWorktreeRetentionPlanInput,
  type CodexManagedWorktreeRetentionRecord,
} from "./codex-managed-worktree-retention";

const nowMs = Date.parse("2026-08-14T00:00:00.000Z");

function record(
  name: string,
  overrides: Partial<CodexManagedWorktreeRetentionRecord> = {},
): CodexManagedWorktreeRetentionRecord {
  return {
    hostId: "local",
    worktreeGitRoot: `/managed/${name}/repo`,
    createdAtMs: nowMs - 2 * CODEX_OWNERLESS_WORKTREE_GRACE_MS,
    ownerThreadId: null,
    ownerReadFailed: false,
    ...overrides,
  };
}

function input(
  records: readonly CodexManagedWorktreeRetentionRecord[],
  overrides: Partial<CodexManagedWorktreeRetentionPlanInput> = {},
): CodexManagedWorktreeRetentionPlanInput {
  return {
    enabled: true,
    keepCount: 1,
    metadataComplete: true,
    records,
    threadMetadata: [],
    pathProtections: [],
    protectPreMigrationOwnerlessWorktrees: true,
    nowMs,
    ...overrides,
  };
}

describe("planManagedWorktreeRetention", () => {
  test("fails closed when disabled, invalid, or metadata is incomplete", () => {
    expect(planManagedWorktreeRetention(input([], { enabled: false }))).toMatchObject({
      status: "skipped",
      reason: "disabled",
    });
    expect(planManagedWorktreeRetention(input([], { keepCount: 0 }))).toMatchObject({
      status: "skipped",
      reason: "invalid-keep-count",
    });
    expect(planManagedWorktreeRetention(input([], { metadataComplete: false }))).toMatchObject({
      status: "skipped",
      reason: "metadata-incomplete",
    });
  });

  test("protects permanent, pending, newborn, pinned, active, automation, and young roots", () => {
    const records = [
      record("permanent"),
      record("pending"),
      record("newborn"),
      record("pinned", { ownerThreadId: "thread-pinned" }),
      record("active", { ownerThreadId: "thread-active" }),
      record("automation", { ownerThreadId: "thread-automation" }),
      record("young", { createdAtMs: nowMs - CODEX_OWNERLESS_WORKTREE_GRACE_MS + 1 }),
      record("delete-old", { createdAtMs: nowMs - 4 * CODEX_OWNERLESS_WORKTREE_GRACE_MS }),
      record("keep-new", { createdAtMs: nowMs - 2 * CODEX_OWNERLESS_WORKTREE_GRACE_MS }),
    ];
    const plan = planManagedWorktreeRetention(
      input(records, {
        threadMetadata: [
          {
            threadId: "thread-pinned",
            updatedAtMs: 1,
            pinned: true,
            inProgress: false,
            automationProtected: false,
          },
          {
            threadId: "thread-active",
            updatedAtMs: 2,
            pinned: false,
            inProgress: true,
            automationProtected: false,
          },
          {
            threadId: "thread-automation",
            updatedAtMs: 3,
            pinned: false,
            inProgress: false,
            automationProtected: true,
          },
        ],
        pathProtections: [
          { hostId: "local", worktreeGitRoot: records[0]!.worktreeGitRoot, reason: "permanent" },
          { hostId: "local", worktreeGitRoot: records[1]!.worktreeGitRoot, reason: "pending" },
          { hostId: "local", worktreeGitRoot: records[2]!.worktreeGitRoot, reason: "newborn" },
        ],
      }),
    );
    expect(plan.status).toBe("planned");
    expect(plan.delete.map((item) => item.worktreeGitRoot)).toEqual([records[7]!.worktreeGitRoot]);
    expect(
      Object.fromEntries(plan.items.map((item) => [item.worktreeGitRoot, item.protectionReasons])),
    ).toMatchObject({
      [records[0]!.worktreeGitRoot]: ["permanent"],
      [records[1]!.worktreeGitRoot]: ["pending"],
      [records[2]!.worktreeGitRoot]: ["newborn"],
      [records[3]!.worktreeGitRoot]: ["pinned"],
      [records[4]!.worktreeGitRoot]: ["in-progress"],
      [records[5]!.worktreeGitRoot]: ["automation"],
      [records[6]!.worktreeGitRoot]: ["young-ownerless"],
    });
  });

  test("uses the exact migration and one-hour boundaries", () => {
    const plan = planManagedWorktreeRetention(
      input([
        record("migration-before", { createdAtMs: CODEX_OWNER_METADATA_MIGRATION_CUTOFF_MS - 1 }),
        record("migration-at", { createdAtMs: CODEX_OWNER_METADATA_MIGRATION_CUTOFF_MS }),
        record("hour-before", { createdAtMs: nowMs - CODEX_OWNERLESS_WORKTREE_GRACE_MS + 1 }),
        record("hour-at", { createdAtMs: nowMs - CODEX_OWNERLESS_WORKTREE_GRACE_MS }),
      ]),
    );
    const reasons = Object.fromEntries(
      plan.items.map((item) => [item.worktreeGitRoot, item.protectionReasons]),
    );
    expect(reasons["/managed/migration-before/repo"]).toContain("pre-migration-ownerless");
    expect(reasons["/managed/migration-at/repo"]).not.toContain("pre-migration-ownerless");
    expect(reasons["/managed/hour-before/repo"]).toContain("young-ownerless");
    expect(reasons["/managed/hour-at/repo"]).not.toContain("young-ownerless");
  });

  test("sorts ownerless first by birthtime, then owned by owner update time with path ties", () => {
    const plan = planManagedWorktreeRetention(
      input(
        [
          record("ownerless-new", { createdAtMs: 20 }),
          record("owner-b", { ownerThreadId: "thread-b" }),
          record("ownerless-old-b", { createdAtMs: 10 }),
          record("owner-a", { ownerThreadId: "thread-a" }),
          record("ownerless-old-a", { createdAtMs: 10 }),
        ],
        {
          keepCount: 2,
          protectPreMigrationOwnerlessWorktrees: false,
          threadMetadata: [
            {
              threadId: "thread-a",
              updatedAtMs: 30,
              pinned: false,
              inProgress: false,
              automationProtected: false,
            },
            {
              threadId: "thread-b",
              updatedAtMs: 40,
              pinned: false,
              inProgress: false,
              automationProtected: false,
            },
          ],
        },
      ),
    );
    expect(plan.orderedCandidates.map((item) => item.worktreeGitRoot)).toEqual([
      "/managed/ownerless-old-a/repo",
      "/managed/ownerless-old-b/repo",
      "/managed/ownerless-new/repo",
      "/managed/owner-a/repo",
      "/managed/owner-b/repo",
    ]);
    expect(plan.delete).toHaveLength(3);
    expect(plan.keep).toHaveLength(2);
  });

  test("counts only eligible roots against keepCount and keeps shared-owner protection", () => {
    const protectedOwner = record("shared", { ownerThreadId: "owner" });
    const plan = planManagedWorktreeRetention(
      input([protectedOwner, record("one"), record("two")], {
        keepCount: 2,
        threadMetadata: [
          {
            threadId: "owner",
            updatedAtMs: 1,
            pinned: true,
            inProgress: false,
            automationProtected: false,
          },
        ],
      }),
    );
    expect(plan.delete).toEqual([]);
    expect(plan.keep).toHaveLength(3);
  });
});
