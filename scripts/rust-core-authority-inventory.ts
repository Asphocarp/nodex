import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

type Classification =
  | "port-to-core"
  | "electron-proxy"
  | "renderer-only"
  | "migration-only-remove"
  | "obsolete-remove";

type Module =
  | "Library"
  | "Database"
  | "Owned Document"
  | "Project Workspace"
  | "Automation"
  | "Store Administration"
  | "Adapter";

interface InventoryEntry {
  readonly file: string;
  readonly surfaces: readonly string[];
  readonly classification: Classification;
  readonly module: Module;
  readonly intent: string;
  readonly tables: readonly string[];
  readonly evidence: readonly string[];
  readonly test: string | null;
}

const repositoryRoot = path.resolve(".");
const outputRoot = path.join(
  repositoryRoot,
  ".generated/rust-core-migration",
);

const trackedFiles = execFileSync("git", ["ls-files", "src", "bin/nodex.mjs"], {
  cwd: repositoryRoot,
  encoding: "utf8",
})
  .trim()
  .split("\n")
  .filter(Boolean);

const productionFiles = trackedFiles.filter(
  (file) =>
    !file.endsWith(".test.ts") &&
    !file.endsWith(".test.tsx") &&
    !file.endsWith(".browser.test.ts") &&
    !file.endsWith(".browser.test.tsx") &&
    !file.endsWith(".stories.tsx") &&
    !file.includes("test-fixture"),
);

const read = (file: string): string =>
  readFileSync(path.join(repositoryRoot, file), "utf8");

const surfaceMatchers = [
  ["sqlite", /better-sqlite3|Database\.Database|getDb\s*\(/],
  ["yjs-authority", /from ["']yjs["']|from ["']y-protocols/],
  ["worker", /BlockMutationWriter|blockMutationWriter|BlockMutationWorker/],
  ["notifier", /DatabaseNotifier|dbNotifier/],
  ["backup-restore", /backup|restore/i],
  ["scheduler", /scheduler|scheduled|reminder|occurrence/i],
  ["http", /http-server|Hono|register.*Routes/],
  ["ipc", /ipc-handlers|ipcMain|IpcMain/],
  ["cli", /bin\/nodex\.mjs|process\.argv/],
] as const;

const classify = (file: string): Classification => {
  if (file.startsWith("src/renderer/")) return "renderer-only";
  if (
    /(?:legacy|shipped-schema|cutover|migration|finalization)/.test(file) &&
    file.startsWith("src/main/local-store/")
  ) {
    return "migration-only-remove";
  }
  if (
    file === "bin/nodex.mjs" ||
    /src\/main\/(?:bootstrap|main-runtime|http-server|ipc-handlers)/.test(file)
  ) {
    return "electron-proxy";
  }
  if (
    file.startsWith("src/main/") ||
    file.startsWith("src/shared/block-documents/")
  ) {
    return "port-to-core";
  }
  return "obsolete-remove";
};

const moduleFor = (file: string): Module => {
  if (
    file === "bin/nodex.mjs" ||
    /(?:bootstrap|main-runtime|http-server|ipc-handlers)/.test(file)
  ) {
    return "Adapter";
  }
  if (/(?:backup|restore|maintenance|schema|database\.ts$)/.test(file)) {
    return "Store Administration";
  }
  if (/(?:automation|schedule|scheduled|reminder|occurrence)/.test(file)) {
    return "Automation";
  }
  if (
    /(?:block-document|document-|canvas|synced-block|template|y-provider)/.test(
      file,
    )
  ) {
    return "Owned Document";
  }
  if (
    /(?:database-module|database-pages|data-source|database-view|block-property)/.test(
      file,
    )
  ) {
    return "Database";
  }
  if (/(?:project|session|codex|worktree|persisted-atoms)/.test(file)) {
    return "Project Workspace";
  }
  return "Library";
};

const intentFor = (module: Module, content: string): string => {
  if (module === "Adapter") return "bind identity and proxy accepted Module read/apply";
  const reads = /\b(?:SELECT|read|get|list|search|query|load)\b/i.test(content);
  const writes = /\b(?:INSERT|UPDATE|DELETE|apply|create|write|persist|restore)\b/i.test(
    content,
  );
  if (reads && writes) return `${module} read/apply aggregate`;
  if (writes) return `${module} apply aggregate`;
  return `${module} read projection`;
};

const sqlTables = (content: string): readonly string[] => {
  const tables = new Set<string>();
  for (const match of content.matchAll(
    /\b(?:FROM|JOIN|INTO|UPDATE|DELETE\s+FROM)\s+([a-z_][a-z0-9_]*)/gi,
  )) {
    const table = match[1]?.toLowerCase();
    if (table && table !== "set") tables.add(table);
  }
  return [...tables].sort();
};

const evidenceFor = (content: string): readonly string[] => {
  const evidence: string[] = [];
  if (/(?:authorize|authority|access|grant|projectId|libraryId)/.test(content)) {
    evidence.push("authorization context");
  }
  if (/(?:receipt|idempotenc|operationId|updateId)/i.test(content)) {
    evidence.push("receipt/idempotency");
  }
  if (/(?:notifier|changeLog|change_log|emit\(|event)/i.test(content)) {
    evidence.push("projection/event publication");
  }
  return evidence;
};

const nearestTest = (file: string): string | null => {
  const candidates = [
    file.replace(/\.tsx?$/, ".test.ts"),
    file.replace(/\.tsx?$/, ".test.tsx"),
  ];
  return candidates.find((candidate) => trackedFiles.includes(candidate)) ?? null;
};

const entries: InventoryEntry[] = productionFiles.flatMap((file) => {
  const content = read(file);
  const surfaces = surfaceMatchers
    .filter(([, matcher]) => matcher.test(content) || matcher.test(file))
    .map(([surface]) => surface);
  if (surfaces.length === 0) return [];
  const module = moduleFor(file);
  return [
    {
      file,
      surfaces,
      classification: classify(file),
      module,
      intent: intentFor(module, content),
      tables: sqlTables(content),
      evidence: evidenceFor(content),
      test: nearestTest(file),
    },
  ];
});

const workerProtocol = read("src/main/block-mutation-worker-protocol.ts");
const workerCommands = [
  ...new Set(
    Array.from(workerProtocol.matchAll(/type: "([^"]+)"/g), (match) => match[1]),
  ),
].sort();

const unclassified = entries.filter(
  (entry) => !entry.classification || !entry.module || !entry.intent,
);
if (unclassified.length > 0) {
  throw new Error(
    `Unclassified authority entries:\n${unclassified.map((entry) => entry.file).join("\n")}`,
  );
}

const escapeCell = (value: string): string => value.replaceAll("|", "\\|");
const renderList = (values: readonly string[]): string =>
  values.length > 0 ? values.map(escapeCell).join(", ") : "—";

const schemaSource = read("src/main/local-store/schema.ts");
const schemaVersion = schemaSource.match(
  /CURRENT_SCHEMA_VERSION\s*=\s*(\d+)/,
)?.[1];
if (!schemaVersion) throw new Error("Could not resolve CURRENT_SCHEMA_VERSION");

const inventory = `# Rust Core authority inventory

Generated by \`pnpm run core:authority:inventory\`. The inventory is evidence for migration planning; classifications describe the target owner, not the current implementation.

- Legacy cutover schema: ${schemaVersion}
- Production authority/adapter files: ${entries.length}
- Direct database files: ${entries.filter((entry) => entry.surfaces.includes("sqlite")).length}
- Authority-side Yjs/y-protocol files: ${entries.filter((entry) => entry.surfaces.includes("yjs-authority") && entry.classification !== "renderer-only").length}
- Worker command discriminants: ${workerCommands.length}

| File | Surfaces | Classification | Target Module | Semantic capability | Hidden tables | Auth / receipt / event evidence | Nearest behavior test |
| --- | --- | --- | --- | --- | --- | --- | --- |
${entries
  .sort((left, right) => left.file.localeCompare(right.file))
  .map(
    (entry) =>
      `| ${escapeCell(entry.file)} | ${renderList(entry.surfaces)} | ${entry.classification} | ${entry.module} | ${escapeCell(entry.intent)} | ${renderList(entry.tables)} | ${renderList(entry.evidence)} | ${entry.test ?? "—"} |`,
  )
  .join("\n")}

## Worker command discriminants

The current worker surface is migration evidence, not the target UDS API. Every command must be absorbed by an owning Module aggregate or removed.

${workerCommands.map((command) => `- \`${command}\``).join("\n")}
`;

const moduleMap = `# Rust Core Module map

Generated alongside the authority inventory. The accepted public surface is six versioned deep Modules with \`read\` and \`apply\`; SQLite, authorization, receipts, the writer, and durable events remain supporting internals.

| Module | Owns | Hides | Reused by |
| --- | --- | --- | --- |
| Library | Page/Database ownership, lifecycle, grants, catalog, assets, references and Library history | ownership closure, protected roots, projections and content events | IPC, loopback HTTP, native CLI, Agent tools |
| Database | Database/Data Source/View schema, membership, values, ranking and filters | field revisions, dormant membership, ranks, batch receipts and invalidations | IPC, loopback HTTP, native CLI, Agent tools |
| Owned Document | Yjs/Yrs Page and body-only Documents plus Canvas scene Documents | generation/head, candidate/commit/swap, history, materialization, sync, Awareness and leases | renderer sync, browser sync, native CLI, Agent tools |
| Project Workspace | Profile/Project execution metadata, bindings, sessions, layouts, thread links and managed worktrees | coherent startup snapshots and persisted execution context | Desktop/Codex Host, native CLI |
| Automation | definitions, schedule state, due leases and completion/failure transitions | durable dispatch/replay state; Electron remains the executor | Desktop/Codex Host, native CLI |
| Store Administration | readiness, schema ownership, migration, backup, restore, integrity, retention and maintenance fences | filesystem paths, SQLite lifecycle, journals and epoch rotation | trusted Desktop Host and native CLI only |

## Cross-Module aggregates that cannot become public call chains

- Project creation currently commits Project/source/order, initial Database/Data Source/View authority, the default Database session, and primary Canvas together. Project Workspace owns the use case and coordinates Database and Owned Document internals inside one writer job; adapters must not call three public Modules sequentially.
- Page and Block moves may update ownership, Documents, Database membership, references, search projections, grants, receipts, and events in one transaction. Library owns the use case and coordinates internal collaborators.
- Backup/restore fences all Modules and rotates the store epoch. Store Administration owns the complete phase machine; callers never drive journal steps.
- Automation definitions currently use TOML as definition authority and SQLite as a runtime mirror. Before the Automation port, the model must be simplified to one Core-owned durable authority; keeping two writable authorities is rejected.

## Rejected shallow alternatives

- Exposing the ${workerCommands.length} worker discriminants as UDS routes.
- Creating entity CRUD routes or a universal JSON Module.
- Letting IPC/HTTP/CLI construct receipts, projections, authorization footprints, or committed events.
- Splitting one live Profile between TypeScript and Rust writers, even by Module.
`;

mkdirSync(outputRoot, { recursive: true });
writeFileSync(path.join(outputRoot, "authority-inventory.md"), inventory);
writeFileSync(path.join(outputRoot, "module-map.md"), moduleMap);

console.log(
  JSON.stringify({
    schemaVersion: Number(schemaVersion),
    entries: entries.length,
    directDatabaseFiles: entries.filter((entry) =>
      entry.surfaces.includes("sqlite"),
    ).length,
    authorityYjsFiles: entries.filter(
      (entry) =>
        entry.surfaces.includes("yjs-authority") &&
        entry.classification !== "renderer-only",
    ).length,
    workerCommands: workerCommands.length,
  }),
);

