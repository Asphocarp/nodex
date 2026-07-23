import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  copyFileSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { build } from "esbuild";

import {
  LEGACY_PROFILE_MIGRATOR_LEGAL_PATH,
  LEGACY_PROFILE_MIGRATOR_MANIFEST_PATH,
  LEGACY_PROFILE_MIGRATOR_OUTPUT_PATH,
  LEGACY_PROFILE_MIGRATOR_SOURCE_COMMIT,
  LEGACY_PROFILE_MIGRATOR_SOURCE_VERSIONS,
  type LegacyProfileMigratorManifest,
  serializeLegacyProfileMigratorManifest,
  verifyLegacyProfileMigratorArtifacts,
} from "./legacy-profile-migrator-artifacts";
import { sha256File } from "./native-runtime-manifest";

type Command = "build" | "verify" | "verify-reproducible";

interface GeneratedArtifacts {
  readonly bundlePath: string;
  readonly legalPath: string;
  readonly manifest: LegacyProfileMigratorManifest;
  readonly temporaryRoot: string;
}

const repositoryRoot = path.resolve(".");
const sourceRoot = path.join(repositoryRoot, "scripts/legacy-profile-migrator");
const scratchRoot = path.join(
  repositoryRoot,
  ".generated/legacy-profile-migrator-builds",
);

const parseCommand = (): Command => {
  const [argument, ...extraArguments] = process.argv.slice(2);
  if (extraArguments.length > 0) {
    throw new Error("Legacy profile migrator build accepts at most one command");
  }
  if (argument === undefined) return "build";
  if (argument === "--verify") return "verify";
  if (argument === "--verify-reproducible") return "verify-reproducible";
  throw new Error(`Unknown legacy profile migrator build command: ${argument}`);
};

const resolveSourceCommit = (): typeof LEGACY_PROFILE_MIGRATOR_SOURCE_COMMIT => {
  let sourceCommit: string;
  try {
    sourceCommit = execFileSync(
      "git",
      ["rev-parse", `${LEGACY_PROFILE_MIGRATOR_SOURCE_COMMIT}^{commit}`],
      { cwd: repositoryRoot, encoding: "utf8" },
    ).trim();
  } catch {
    throw new Error(
      `Legacy profile migrator source commit is unavailable: ${LEGACY_PROFILE_MIGRATOR_SOURCE_COMMIT}`,
    );
  }
  if (sourceCommit !== LEGACY_PROFILE_MIGRATOR_SOURCE_COMMIT) {
    throw new Error(`Unexpected legacy profile migrator source commit: ${sourceCommit}`);
  }
  return LEGACY_PROFILE_MIGRATOR_SOURCE_COMMIT;
};

const assertPortableBundle = (bundle: string): void => {
  const candidateRoots = new Set([
    repositoryRoot,
    repositoryRoot.split(path.sep).join("/"),
    repositoryRoot.split(path.sep).join("\\"),
  ]);
  if ([...candidateRoots].some((candidate) => bundle.includes(candidate))) {
    throw new Error("Legacy profile migrator bundle contains its build checkout path");
  }
};

const replaceExactOnce = (
  contents: string,
  before: string,
  after: string,
  label: string,
): string => {
  const firstIndex = contents.indexOf(before);
  if (firstIndex < 0 || firstIndex !== contents.lastIndexOf(before)) {
    throw new Error(`Legacy profile migrator compatibility overlay is ambiguous: ${label}`);
  }
  return `${contents.slice(0, firstIndex)}${after}${contents.slice(firstIndex + before.length)}`;
};

const applyCompatibilityOverlays = (migrationSource: string): void => {
  const workflowStatusCutoverPath = path.join(
    migrationSource,
    "src/shared/workflow-status-cutover.ts",
  );
  const workflowStatusCutover = readFileSync(workflowStatusCutoverPath, "utf8");
  writeFileSync(
    workflowStatusCutoverPath,
    replaceExactOnce(
      workflowStatusCutover,
      `export function upgradeLegacyWorkflowStatus(
  value: unknown,
): WorkflowStatus | null {
  if (isWorkflowStatus(value)) return value;
  if (!isLegacyWorkflowStatus(value)) return null;
  return WORKFLOW_STATUS_CUTOVER_MAP[value];
}`,
      `export function upgradeLegacyWorkflowStatus(
  value: unknown,
): WorkflowStatus | null {
  if (isWorkflowStatus(value)) return value;
  if (!isLegacyWorkflowStatus(value)) return null;
  return WORKFLOW_STATUS_CUTOVER_MAP[value];
}

const LEGACY_WORKFLOW_STATUS_BY_STATUS: Readonly<
  Record<WorkflowStatus, LegacyWorkflowStatus>
> = {
  triage: "draft",
  plan: "backlog",
  build: "in_progress",
  review: "in_review",
  ship: "done",
};

export function downgradeWorkflowStatus(
  value: WorkflowStatus,
): LegacyWorkflowStatus {
  return LEGACY_WORKFLOW_STATUS_BY_STATUS[value];
}`,
      "legacy workflow status downgrade",
    ),
  );

  const foreignReferenceMigrationPath = path.join(
    migrationSource,
    "src/main/local-store/foreign-reference-migration.ts",
  );
  const foreignReferenceMigration = readFileSync(foreignReferenceMigrationPath, "utf8");
  const withStatusDowngradeImport = replaceExactOnce(
    foreignReferenceMigration,
    `import { upgradeLegacyWorkflowStatus } from "../../shared/workflow-status-cutover";`,
    `import {
  downgradeWorkflowStatus,
  upgradeLegacyWorkflowStatus,
} from "../../shared/workflow-status-cutover";`,
    "legacy workflow status downgrade import",
  );
  const withProjectionAdapterImport = replaceExactOnce(
    withStatusDowngradeImport,
    `import { persistPageDocumentMaterialization } from "./document-materializations";`,
    `import { persistPageDocumentMaterialization } from "./document-materializations";
import { withPageNamedProjectionStorage } from "./legacy-page-projection-adapter";`,
    "legacy Page projection adapter import",
  );
  const withLegacyRecoveryStatusQuery = replaceExactOnce(
    withProjectionAdapterImport,
    `    .get(input.projectId, input.status) as { readonly next_order: number };`,
    `    .get(
      input.projectId,
      downgradeWorkflowStatus(input.status),
    ) as { readonly next_order: number };`,
    "legacy recovered Card ordering status",
  );
  const withLegacyRecoveryStatusInsert = replaceExactOnce(
    withLegacyRecoveryStatusQuery,
    `      input.projectId,
      input.status,
      input.card.title,`,
    `      input.projectId,
      downgradeWorkflowStatus(input.status),
      input.card.title,`,
    "legacy recovered Card inserted status",
  );
  writeFileSync(
    foreignReferenceMigrationPath,
    replaceExactOnce(
      withLegacyRecoveryStatusInsert,
      `      ((
        input: UpsertLegacyInlineDatabaseViewInput,
        target: Database.Database,
      ) => upsertLegacyInlineDatabaseView(input, target)),`,
      `      ((
        input: UpsertLegacyInlineDatabaseViewInput,
        target: Database.Database,
      ) =>
        withPageNamedProjectionStorage(target, () =>
          upsertLegacyInlineDatabaseView(input, target),
        )),`,
      "legacy inline-View projection coordinates",
    ),
  );

  const legacyInlineViewsPath = path.join(
    migrationSource,
    "src/main/local-store/legacy-inline-database-views.ts",
  );
  const legacyInlineViews = readFileSync(legacyInlineViewsPath, "utf8");
  const withDatabaseKernelTypes = replaceExactOnce(
    legacyInlineViews,
    `import type Database from "better-sqlite3";
import type {`,
    `import type Database from "better-sqlite3";
import type {
  DatabaseJsonValue,
  DatabaseViewFilterNode,
} from "../../shared/database-kernel";
import type {`,
    "legacy inline-View filter types",
  );
  const withWorkflowStatusImports = replaceExactOnce(
    withDatabaseKernelTypes,
    `import { readDatabasePageSummariesByIds } from "./database-pages";`,
    `import {
  downgradeWorkflowStatus,
} from "../../shared/workflow-status-cutover";
import { isWorkflowStatus } from "../../shared/workflow-status";
import { readDatabasePageSummariesByIds } from "./database-pages";`,
    "legacy inline-View workflow status imports",
  );
  const withStatusFilterDowngrade = replaceExactOnce(
    withWorkflowStatusImports,
    `export const upsertLegacyInlineDatabaseView = (
  input: UpsertLegacyInlineDatabaseViewInput,`,
    `const downgradeStatusFilterValue = (
  value: DatabaseJsonValue,
): DatabaseJsonValue => {
  if (typeof value === "string" && isWorkflowStatus(value)) {
    return downgradeWorkflowStatus(value);
  }
  if (Array.isArray(value)) return value.map(downgradeStatusFilterValue);
  return value;
};

const downgradeStatusFilter = (
  filter: DatabaseViewFilterNode,
): DatabaseViewFilterNode => {
  if (filter.kind === "group") {
    return {
      ...filter,
      children: filter.children.map(downgradeStatusFilter),
    };
  }
  if (
    !filter.propertyId.endsWith(":property:status")
    || filter.value === undefined
  ) {
    return filter;
  }
  return {
    ...filter,
    value: downgradeStatusFilterValue(filter.value),
  };
};

export const upsertLegacyInlineDatabaseView = (
  input: UpsertLegacyInlineDatabaseViewInput,`,
    "legacy inline-View status filter downgrade",
  );
  writeFileSync(
    legacyInlineViewsPath,
    replaceExactOnce(
      withStatusFilterDowngrade,
      `    const configJson = stringifyConfig(config);`,
      `    const configJson = stringifyConfig({
      ...config,
      filter: downgradeStatusFilter(config.filter),
    });`,
      "legacy inline-View downgraded config",
    ),
  );

  const schemaPath = path.join(
    migrationSource,
    "src/main/local-store/schema.ts",
  );
  const schema = readFileSync(schemaPath, "utf8");
  const withImportedForeignPageGrants = replaceExactOnce(
    schema,
    `export function migrateSchema67To68(db: Database.Database): void {`,
    `function materializeImportedForeignPageReadGrants(
  db: Database.Database,
): void {
  const rows = db.prepare(\`
    SELECT DISTINCT
      document.project_id,
      target.id AS target_block_id,
      project.library_id
    FROM documents document
    INNER JOIN projects project ON project.id = document.project_id
    INNER JOIN document_materializations materialization
      ON materialization.document_id = document.id
      AND materialization.generation = document.generation
      AND materialization.projected_seq = document.head_seq
    INNER JOIN json_each(materialization.references_json) reference
    INNER JOIN blocks target
      ON target.id = json_extract(reference.value, '$.targetBlockId')
    INNER JOIN projects target_project ON target_project.id = target.project_id
    WHERE document.readiness = 'ready'
      AND json_extract(reference.value, '$.kind') = 'block'
      AND target.type = 'page'
      AND target.lifecycle <> 'deleted'
      AND target.project_id <> document.project_id
      AND target_project.library_id = project.library_id
    ORDER BY document.project_id, target.id
  \`).all() as readonly {
    readonly project_id: string;
    readonly target_block_id: string;
    readonly library_id: string;
  }[];
  const insert = db.prepare(\`
    INSERT INTO project_resource_grants (
      id, project_id, library_id, root_kind, root_id, access, recursive,
      revision, lifecycle, created_at, updated_at
    ) VALUES (?, ?, ?, 'page', ?, 'read', 1, 1, 'active', ?, ?)
    ON CONFLICT(project_id, root_kind, root_id) DO NOTHING
  \`);
  const now = new Date().toISOString();
  for (const row of rows) {
    insert.run(
      randomUUID(),
      row.project_id,
      row.library_id,
      row.target_block_id,
      now,
      now,
    );
  }
}

export function migrateSchema67To68(db: Database.Database): void {`,
    "legacy cross-Project Page read grants",
  );
  const withImportedForeignPageGrantCall = replaceExactOnce(
    withImportedForeignPageGrants,
    `    createLibraryDatabaseFoundationSchema(db);`,
    `    createLibraryDatabaseFoundationSchema(db);
    materializeImportedForeignPageReadGrants(db);
`,
    "legacy cross-Project Page read grant call",
  );
  writeFileSync(
    schemaPath,
    replaceExactOnce(
      withImportedForeignPageGrantCall,
      `  assertShippedImportSource(db);
  cutoverImportedCanvasAuthority(db, { assetsRootPath });`,
      `  assertShippedImportSource(db);
  materializeImportedDatabasePropertyConfigs(db);
  cutoverImportedCanvasAuthority(db, { assetsRootPath });`,
      "recovered Card option registries",
    ),
  );

  const databaseIdentityCutoverPath = path.join(
    migrationSource,
    "src/main/local-store/database-identity-cutover-sqlite.ts",
  );
  const databaseIdentityCutover = readFileSync(
    databaseIdentityCutoverPath,
    "utf8",
  );
  const withIdentityTokenMatcher = replaceExactOnce(
    databaseIdentityCutover,
    `const containsChangedIdentity = (
  values: readonly string[],
  candidate: string,
): boolean => values.some((value) => candidate.includes(value));`,
    `const identityTokenCharacterPattern = /[A-Za-z0-9_-]/u;

const containsIdentityToken = (
  candidate: string,
  identity: string,
): boolean => {
  let searchFrom = 0;
  while (searchFrom <= candidate.length - identity.length) {
    const index = candidate.indexOf(identity, searchFrom);
    if (index < 0) return false;
    const before = index === 0 ? undefined : candidate[index - 1];
    const afterIndex = index + identity.length;
    const after =
      afterIndex >= candidate.length ? undefined : candidate[afterIndex];
    if (
      (before === undefined || !identityTokenCharacterPattern.test(before))
      && (after === undefined || !identityTokenCharacterPattern.test(after))
    ) {
      return true;
    }
    searchFrom = index + 1;
  }
  return false;
};

const containsChangedIdentity = (
  values: readonly string[],
  candidate: string,
): boolean =>
  values.some((value) => containsIdentityToken(candidate, value));`,
    "legacy identity token matcher",
  );
  const withoutOpaqueProjectSessionAudit = replaceExactOnce(
    withIdentityTokenMatcher,
    `  if (tableExists(input.database, "project_session_tabs")) {
    append("Project session state", input.database.prepare(\`
      SELECT config_json AS value FROM project_session_tabs
      UNION ALL SELECT state_json FROM project_session_tabs
    \`).all() as readonly { readonly value: string }[]);
  }
`,
    "",
    "opaque Project session identity audit",
  );
  writeFileSync(
    databaseIdentityCutoverPath,
    replaceExactOnce(
      withoutOpaqueProjectSessionAudit,
      `    const retained = samples.find((sample) => sample.value.includes(identity));`,
      `    const retained = samples.find((sample) =>
      containsIdentityToken(sample.value, identity));`,
      "legacy identity residue audit",
    ),
  );
};

const generateArtifacts = async (): Promise<GeneratedArtifacts> => {
  const sourceCommit = resolveSourceCommit();
  mkdirSync(scratchRoot, { recursive: true });
  const temporaryRoot = mkdtempSync(path.join(scratchRoot, "build-"));
  const archivePath = path.join(temporaryRoot, "source.tar");
  const checkoutRoot = path.join(temporaryRoot, "checkout");
  const outputRoot = path.join(temporaryRoot, "output");
  const bundlePath = path.join(outputRoot, path.basename(LEGACY_PROFILE_MIGRATOR_OUTPUT_PATH));
  const legalPath = `${bundlePath}.LEGAL.txt`;

  try {
    mkdirSync(checkoutRoot, { recursive: true });
    mkdirSync(outputRoot, { recursive: true });
    execFileSync(
      "git",
      [
        "archive",
        "--format=tar",
        `--output=${archivePath}`,
        LEGACY_PROFILE_MIGRATOR_SOURCE_COMMIT,
      ],
      { cwd: repositoryRoot },
    );
    execFileSync("tar", ["-xf", archivePath, "-C", checkoutRoot]);

    const migrationSource = path.join(checkoutRoot, "legacy-source");
    mkdirSync(migrationSource, { recursive: true });
    for (const entry of ["src", "packages", "third_party"]) {
      renameSync(path.join(checkoutRoot, entry), path.join(migrationSource, entry));
    }
    applyCompatibilityOverlays(migrationSource);
    copyFileSync(
      path.join(sourceRoot, "entry.ts.template"),
      path.join(checkoutRoot, "entry.ts"),
    );
    copyFileSync(
      path.join(sourceRoot, "sqlite-adapter.ts.template"),
      path.join(checkoutRoot, "sqlite-adapter.ts"),
    );

    await build({
      absWorkingDir: checkoutRoot,
      alias: { "better-sqlite3": "./sqlite-adapter.ts" },
      bundle: true,
      entryPoints: ["entry.ts"],
      format: "esm",
      legalComments: "linked",
      nodePaths: [path.join(repositoryRoot, "node_modules")],
      outfile: bundlePath,
      platform: "node",
      plugins: [
        {
          name: "discard-browser-css",
          setup(buildContext) {
            buildContext.onLoad({ filter: /\.css$/ }, () => ({
              contents: "",
              loader: "js",
            }));
          },
        },
      ],
      target: "node24",
    });
    const normalizedBundle = readFileSync(bundlePath, "utf8").replace(/[ \t]+$/gmu, "");
    assertPortableBundle(normalizedBundle);
    writeFileSync(bundlePath, normalizedBundle);
    const manifest: LegacyProfileMigratorManifest = {
      schemaVersion: 1,
      sourceCommit,
      supportedSourceVersions: LEGACY_PROFILE_MIGRATOR_SOURCE_VERSIONS,
      targetSchemaVersion: 84,
      bundle: {
        path: LEGACY_PROFILE_MIGRATOR_OUTPUT_PATH,
        sha256: sha256File(bundlePath),
        size: lstatSync(bundlePath).size,
      },
      legalNotices: {
        path: LEGACY_PROFILE_MIGRATOR_LEGAL_PATH,
        sha256: sha256File(legalPath),
        size: lstatSync(legalPath).size,
      },
    };
    return { bundlePath, legalPath, manifest, temporaryRoot };
  } catch (error) {
    rmSync(temporaryRoot, { force: true, recursive: true });
    throw error;
  }
};

const promoteFile = (sourcePath: string, destinationPath: string): void => {
  const stagingPath = `${destinationPath}.${randomUUID()}.tmp`;
  try {
    copyFileSync(sourcePath, stagingPath);
    renameSync(stagingPath, destinationPath);
  } finally {
    rmSync(stagingPath, { force: true });
  }
};

const promoteText = (contents: string, destinationPath: string): void => {
  const stagingPath = `${destinationPath}.${randomUUID()}.tmp`;
  try {
    writeFileSync(stagingPath, contents);
    renameSync(stagingPath, destinationPath);
  } finally {
    rmSync(stagingPath, { force: true });
  }
};

const installGeneratedArtifacts = (artifacts: GeneratedArtifacts): void => {
  const bundlePath = path.join(repositoryRoot, LEGACY_PROFILE_MIGRATOR_OUTPUT_PATH);
  const legalPath = path.join(repositoryRoot, LEGACY_PROFILE_MIGRATOR_LEGAL_PATH);
  const manifestPath = path.join(repositoryRoot, LEGACY_PROFILE_MIGRATOR_MANIFEST_PATH);
  mkdirSync(path.dirname(bundlePath), { recursive: true });
  promoteFile(artifacts.bundlePath, bundlePath);
  promoteFile(artifacts.legalPath, legalPath);
  promoteText(serializeLegacyProfileMigratorManifest(artifacts.manifest), manifestPath);
};

const assertEqualFile = (actualPath: string, expectedPath: string, label: string): void => {
  if (readFileSync(actualPath).equals(readFileSync(expectedPath))) return;
  throw new Error(`Legacy profile migrator ${label} is not reproducible`);
};

const verifyReproducibleArtifacts = async (): Promise<LegacyProfileMigratorManifest> => {
  const checkedManifest = verifyLegacyProfileMigratorArtifacts(repositoryRoot);
  const generated = await generateArtifacts();
  try {
    const generatedManifest = serializeLegacyProfileMigratorManifest(generated.manifest);
    const checkedManifestPath = path.join(
      repositoryRoot,
      LEGACY_PROFILE_MIGRATOR_MANIFEST_PATH,
    );
    if (readFileSync(checkedManifestPath, "utf8") !== generatedManifest) {
      throw new Error("Legacy profile migrator manifest is not reproducible");
    }
    assertEqualFile(
      generated.bundlePath,
      path.join(repositoryRoot, LEGACY_PROFILE_MIGRATOR_OUTPUT_PATH),
      "bundle",
    );
    assertEqualFile(
      generated.legalPath,
      path.join(repositoryRoot, LEGACY_PROFILE_MIGRATOR_LEGAL_PATH),
      "legal notices",
    );
    return checkedManifest;
  } finally {
    rmSync(generated.temporaryRoot, { force: true, recursive: true });
  }
};

const main = async (): Promise<void> => {
  const command = parseCommand();
  if (command === "verify") {
    const manifest = verifyLegacyProfileMigratorArtifacts(repositoryRoot);
    process.stdout.write(`${JSON.stringify(manifest)}\n`);
    return;
  }
  if (command === "verify-reproducible") {
    const manifest = await verifyReproducibleArtifacts();
    process.stdout.write(`${JSON.stringify(manifest)}\n`);
    return;
  }

  const generated = await generateArtifacts();
  try {
    installGeneratedArtifacts(generated);
    process.stdout.write(`${JSON.stringify(generated.manifest)}\n`);
  } finally {
    rmSync(generated.temporaryRoot, { force: true, recursive: true });
  }
};

void main();
