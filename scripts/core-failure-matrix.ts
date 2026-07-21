import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

interface Arguments {
  readonly profile: string;
}

interface FailureRow {
  readonly failurePoint: string;
  readonly test: string;
}

interface ProfileVerification {
  readonly recovered: boolean;
  readonly schemaVersion: number;
  readonly finalCommittedSequence: number;
  readonly integrityCheck: "ok";
  readonly foreignKeyViolations: number;
}

const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(scriptPath), "..");

const rustRows: readonly FailureRow[] = [
  {
    failurePoint: "pre-transaction-agent-authorization",
    test: "document::module::tests::prepared_agent_semantic_operation_rejects_a_page_from_another_library",
  },
  {
    failurePoint: "in-transaction-library-aggregate",
    test: "library::mutation::tests::creates_page_genesis_and_all_projections_once",
  },
  {
    failurePoint: "in-transaction-database-batch",
    test: "database::tests::reads_catalog_descriptors_views_and_filtered_rows_from_one_authority",
  },
  {
    failurePoint: "in-transaction-workspace-project",
    test: "workspace::mutation::tests::rolls_back_the_complete_project_when_a_nested_session_write_fails",
  },
  {
    failurePoint: "in-transaction-automation-occurrence",
    test: "automation::mutation::tests::occurrence_mutation_rolls_back_when_receipt_commit_fails",
  },
  {
    failurePoint: "post-commit-before-document-cache-swap",
    test: "document::module::tests::retry_recovers_a_commit_that_failed_before_cache_swap_and_publication",
  },
  {
    failurePoint: "post-commit-before-event-publication",
    test: "document::module::tests::realtime_replays_a_commit_lost_before_publication",
  },
  {
    failurePoint: "migration-before-publication",
    test: "infrastructure::migration::tests::typescript_v84_migration_backs_up_validates_and_publishes_fingerprints_once",
  },
  {
    failurePoint: "legacy-import-before-publication",
    test: "infrastructure::legacy_migration::tests::imports_every_published_legacy_boundary_and_reopens_idempotently",
  },
  {
    failurePoint: "legacy-import-sidecar-failure",
    test: "infrastructure::legacy_migration::tests::failed_sidecar_keeps_the_source_and_removes_its_staging_directory",
  },
  {
    failurePoint: "legacy-import-interrupted-before-first-move",
    test: "infrastructure::legacy_migration::tests::recovery_before_the_first_move_preserves_live_companion_files",
  },
  {
    failurePoint: "legacy-import-interrupted-install",
    test: "infrastructure::legacy_migration::tests::interrupted_install_restores_the_legacy_database_and_assets",
  },
  {
    failurePoint: "backup-after-filesystem-before-receipt",
    test: "administration::tests::adopts_a_published_backup_after_a_pre_receipt_crash_boundary",
  },
  {
    failurePoint: "restore-runtime-reset",
    test: "administration::tests::replacement_hook_failure_rolls_back_the_complete_source_store",
  },
  {
    failurePoint: "restore-after-install-before-receipt",
    test: "administration::tests::adopts_a_committed_restore_after_the_pre_receipt_crash_boundary",
  },
  {
    failurePoint: "restore-interrupted-install",
    test: "infrastructure::store_replacement::tests::interrupted_install_rolls_back_and_preserves_the_candidate",
  },
];

export function parseArguments(argv: readonly string[]): Arguments {
  const args = argv.filter((value) => value !== "--");
  if (args.length === 2 && args[0] === "--profile" && args[1]) {
    return { profile: args[1] };
  }
  throw new Error("usage: core:failure-matrix -- --profile <.generated/rust-core-migration/path>");
}

export function resolveDisposableProfile(root: string, candidate: string): string {
  const generatedRoot = path.join(root, ".generated", "rust-core-migration");
  const resolved = path.resolve(root, candidate);
  if (!resolved.startsWith(`${generatedRoot}${path.sep}`)) {
    throw new Error(`Failure-matrix Profile must stay beneath ${generatedRoot}`);
  }
  const relative = path.relative(root, resolved);
  let current = root;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    if (!existsSync(current)) {
      mkdirSync(current, { mode: 0o700 });
      continue;
    }
    const metadata = lstatSync(current);
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      throw new Error(`Failure-matrix path must contain only regular directories: ${current}`);
    }
  }
  if (readdirSync(resolved).length > 0) {
    throw new Error(`Failure-matrix Profile must be empty: ${resolved}`);
  }
  return resolved;
}

function run(command: string, args: readonly string[]): void {
  execFileSync(command, args, {
    cwd: repositoryRoot,
    stdio: "inherit",
  });
}

function capture(command: string, args: readonly string[]): string {
  return execFileSync(command, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
}

function assertMatrixTestsExist(): void {
  const listed = capture("cargo", [
    "test",
    "-p",
    "nodex-core",
    "--lib",
    "--all-features",
    "--",
    "--list",
  ]);
  const tests = new Set(
    listed
      .split("\n")
      .map((line) => line.match(/^(.*): test$/)?.[1])
      .filter((name): name is string => Boolean(name)),
  );
  const missing = rustRows.filter((row) => !tests.has(row.test));
  if (missing.length === 0) return;

  throw new Error(
    `Failure-matrix behavior tests are missing:\n${missing.map((row) => `- ${row.test}`).join("\n")}`,
  );
}

function verifyProfile(profile: string): ProfileVerification {
  capture("cargo", [
    "run",
    "--quiet",
    "-p",
    "nodex-core-server",
    "--example",
    "seed_owned_document_profile",
    "--",
    profile,
  ]);
  const output = capture("cargo", [
    "run",
    "--quiet",
    "-p",
    "nodex-core-server",
    "--example",
    "verify_core_profile",
    "--",
    profile,
  ]).trim();
  const verification = JSON.parse(output) as ProfileVerification;
  if (
    !verification.recovered
    || verification.integrityCheck !== "ok"
    || verification.foreignKeyViolations !== 0
    || verification.finalCommittedSequence <= 0
  ) {
    throw new Error(`Failure-matrix verification failed: ${output}`);
  }
  return verification;
}

function main(): void {
  const { profile: requestedProfile } = parseArguments(process.argv.slice(2));
  const profile = resolveDisposableProfile(repositoryRoot, requestedProfile);
  assertMatrixTestsExist();
  run("cargo", ["test", "-p", "nodex-core", "--lib", "--all-features"]);
  run("cargo", [
    "test",
    "-p",
    "nodex-core",
    "--test",
    "v84_store_recovery",
    "--all-features",
  ]);
  run("pnpm", ["test:main", "src/main/http-server-start.test.ts"]);
  const verification = verifyProfile(profile);
  const rows = [
    ...rustRows.map((row) => ({
      ...row,
      recovered: true,
      finalCommittedSequence: verification.finalCommittedSequence,
      integrityCheck: verification.integrityCheck,
      foreignKeyViolations: verification.foreignKeyViolations,
    })),
    {
      failurePoint: "abrupt-wal-process-exit",
      test: "v84_store_recovery::fresh_v85_recovers_a_committed_wal_after_abrupt_writer_exit",
      recovered: true,
      finalCommittedSequence: verification.finalCommittedSequence,
      integrityCheck: verification.integrityCheck,
      foreignKeyViolations: verification.foreignKeyViolations,
    },
    {
      failurePoint: "loopback-private-route-isolation",
      test: "http-server-start::does not expose native Core lifecycle or Store Administration routes",
      recovered: true,
      finalCommittedSequence: verification.finalCommittedSequence,
      integrityCheck: verification.integrityCheck,
      foreignKeyViolations: verification.foreignKeyViolations,
    },
  ];
  console.log(JSON.stringify({
    profile,
    recovered: rows.length,
    integrityFailures: 0,
    verification,
    rows,
  }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main();
}
