import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

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

interface Capability {
  readonly module: Module;
  readonly intent: string;
  readonly callerNeed: string;
}

interface InventoryEntry extends Capability {
  readonly file: string;
  readonly surfaces: readonly string[];
  readonly classification: Classification;
  readonly tables: readonly string[];
  readonly evidence: readonly string[];
  readonly test: string | null;
}

interface CapabilityRule extends Capability {
  readonly pattern: RegExp;
}

interface WorkerCommandEntry extends Capability {
  readonly command: string;
}

const repositoryRoot = path.resolve(".");
const outputRoot = path.join(repositoryRoot, ".generated/rust-core-migration");
const sourceExtensions = new Set([".ts", ".tsx", ".mts", ".cts", ".mjs"]);

const trackedFiles = execFileSync("git", ["ls-files", "src", "bin/nodex.mjs"], {
  cwd: repositoryRoot,
  encoding: "utf8",
})
  .trim()
  .split("\n")
  .filter(Boolean);

const productionFiles = trackedFiles.filter((file) => {
  if (!sourceExtensions.has(path.extname(file))) return false;
  return (
    !file.endsWith(".test.ts") &&
    !file.endsWith(".test.tsx") &&
    !file.endsWith(".browser.test.ts") &&
    !file.endsWith(".browser.test.tsx") &&
    !file.endsWith(".stories.tsx") &&
    !file.includes("test-fixture")
  );
});

const read = (file: string): string =>
  readFileSync(path.join(repositoryRoot, file), "utf8");

const surfaceRules = [
  {
    name: "store-owner",
    matches: (file: string) => file.startsWith("src/main/local-store/"),
  },
  {
    name: "store-call",
    matches: (_file: string, content: string) =>
      /from ["'][^"']*local-store(?:\/|["'])/.test(content),
  },
  {
    name: "sqlite",
    matches: (_file: string, content: string) =>
      /from ["']better-sqlite3["']|\bDatabase\.Database\b|\bgetDb\s*\(/.test(
        content,
      ),
  },
  {
    name: "yjs-authority",
    matches: (_file: string, content: string) =>
      /from ["']yjs["']|from ["']y-protocols\//.test(content),
  },
  {
    name: "worker",
    matches: (file: string, content: string) =>
      /src\/main\/block-mutation-(?:writer|worker)/.test(file) ||
      /\b(?:BlockMutationWriter|blockMutationWriter|BlockMutationWorker)\b/.test(
        content,
      ),
  },
  {
    name: "notifier",
    matches: (file: string, content: string) =>
      file === "src/main/local-store/notifier.ts" ||
      /\b(?:DatabaseNotifier|dbNotifier)\b/.test(content),
  },
  {
    name: "backup-restore",
    matches: (file: string, content: string) =>
      /(?:backup|restore|maintenance)/.test(path.basename(file)) ||
      /from ["'][^"']*(?:backup|restore|maintenance)[^"']*["']/.test(content),
  },
  {
    name: "scheduler",
    matches: (file: string, content: string) =>
      /(?:automation|scheduled|schedule|occurrence|reminder|recurrence)/.test(
        path.basename(file),
      ) ||
      /from ["'][^"']*(?:automation|scheduled|schedule|occurrence|reminder|recurrence)[^"']*["']/.test(
        content,
      ),
  },
  {
    name: "workspace-store",
    matches: (file: string) =>
      file.startsWith("src/main/local-store/") &&
      /(?:project|session|codex|worktree|persisted-atoms)/.test(path.basename(file)),
  },
  {
    name: "http",
    matches: (file: string, content: string) =>
      /(?:http-server|document-sync-http)/.test(file) ||
      /from ["']hono["']|\bregister[A-Za-z]+Routes\b/.test(content),
  },
  {
    name: "ipc",
    matches: (file: string, content: string) =>
      /ipc-handlers/.test(file) || /\b(?:ipcMain|IpcMain)\b/.test(content),
  },
  {
    name: "cli",
    matches: (file: string) => file === "bin/nodex.mjs",
  },
] as const;

const capabilityRules: readonly CapabilityRule[] = [
  {
    pattern: /^src\/shared\/core-modules\/(?:common|events|index)\.ts$/,
    module: "Adapter",
    intent: "define transport-neutral shared Module envelopes and committed event aggregation",
    callerNeed: "all Adapters need one generated contract vocabulary without acquiring domain authority",
  },
  {
    pattern: /^(?:bin\/nodex\.mjs|src\/main\/(?:bootstrap|main-runtime|http-server|ipc-handlers|document-sync-http|browser-sidebar-service|clipboard-image-writer|rust-data-authority(?:\.integration)?)\.ts|src\/main\/core-client\/|src\/main\/[^/]+-(?:http|ipc-handlers)\.ts$|src\/main\/local-store\/config\.ts$|src\/main\/logging\/logger\.ts$)/,
    module: "Adapter",
    intent: "bind host identity and proxy accepted Module read/apply operations",
    callerNeed: "Desktop, HTTP, IPC, and legacy CLI clients need stable transport contracts without store access",
  },
  {
    pattern: /^src\/main\/block-mutation-(?:worker|writer|worker-protocol)\.ts$/,
    module: "Adapter",
    intent: "retire the shallow TypeScript writer switchboard after its commands move into deep Modules",
    callerNeed: "callers need preserved semantic outcomes, not the old worker transport or command graph",
  },
  {
    pattern: /^src\/shared\/block-documents\//,
    module: "Owned Document",
    intent: "define or execute collaborative Document semantics shared with the renderer oracle",
    callerNeed: "Core needs behaviorally equivalent schema, mutation, and validation semantics",
  },
  {
    pattern: /(?:administration|backup|restore|maintenance|schema|database-file-migration|database-identity-cutover|workflow-status-cutover|sql-inspection|block-retention|block-store-metadata|database\.ts$)/,
    module: "Store Administration",
    intent: "inspect, migrate, fence, retain, back up, or restore the Profile store",
    callerNeed: "trusted maintenance callers need whole-store lifecycle operations with one exclusive authority",
  },
  {
    pattern: /(?:authoritative-operation-receipts|nodex-agent-(?:cursor-codec|etag|signing-key))/,
    module: "Library",
    intent: "bind Library operations to durable receipts, scoped guards, cursors, and signing authority",
    callerNeed: "semantic tools need idempotent replay and scope-safe pagination/concurrency guards",
  },
  {
    pattern: /(?:block-first-finalization|legacy-card|retired-card-agent-properties-finalization)/,
    module: "Library",
    intent: "retire the v82-only implementation after finalizing legacy Page and Block authority",
    callerNeed: "the one-way v82 importer must preserve the accepted final Library state, not the legacy dual authority",
  },
  {
    pattern: /(?:database-module|database-pages|data-source|database-view|block-property|fractional-rank|initial-database-authority)/,
    module: "Database",
    intent: "read or apply Database, Data Source, View, membership, value, or ranking semantics",
    callerNeed: "Page and Database clients need typed field revisions and batch mutations without table-level CRUD",
  },
  {
    pattern: /(?:block-document|document-|document-sync|canvas|synced-block|template|y-provider|additional-document|owned-block|page-history)/,
    module: "Owned Document",
    intent: "read, synchronize, mutate, reconstruct, or maintain an owned collaborative Document",
    callerNeed: "renderers and semantic tools need Yjs-compatible content, history, materialization, and committed heads",
  },
  {
    pattern: /(?:automation|scheduled|schedule|occurrence|reminder|recurrence)/,
    module: "Automation",
    intent: "read or advance durable scheduling and automation state",
    callerNeed: "the Desktop executor needs due work and atomic completion/failure transitions",
  },
  {
    pattern: /(?:project|session|codex|worktree|persisted-atom|source-root|thread-link|sidebar-chat)/,
    module: "Project Workspace",
    intent: "read or mutate coherent Project execution context",
    callerNeed: "Desktop and Codex hosts need scoped Projects, sessions, layouts, thread links, and launch authority",
  },
  {
    pattern: /(?:agent-tools|library|page|block-transfer|block-relocation|assets|content-resource|reference|description-revision|notifier|pages\.ts$|board-read-model)/,
    module: "Library",
    intent: "read or apply Library content, ownership, lifecycle, grants, assets, references, or projections",
    callerNeed: "Library clients need semantic Page and Block capabilities with authorization, receipts, and events hidden",
  },
  {
    pattern: /^src\/renderer\//,
    module: "Owned Document",
    intent: "consume renderer-local collaborative state and Core notifications",
    callerNeed: "the editor must retain Yjs and UI state while surrendering durable authority",
  },
];

const migrationOnly = (file: string): boolean =>
  file.startsWith("src/main/local-store/") &&
  /(?:legacy|shipped-schema|cutover|migration|finalization)/.test(file);

const classify = (file: string): Classification => {
  if (file.startsWith("src/renderer/")) return "renderer-only";
  if (migrationOnly(file)) return "migration-only-remove";
  if (/^src\/main\/block-mutation-(?:worker|writer|worker-protocol)\.ts$/.test(file)) {
    return "obsolete-remove";
  }
  if (
    file === "bin/nodex.mjs" ||
    /src\/main\/(?:bootstrap|main-runtime|http-server|ipc-handlers|document-sync-http)/.test(file) ||
    /^src\/main\/[^/]+-(?:http|ipc-handlers)\.ts$/.test(file) ||
    /src\/main\/(?:browser-sidebar-service|clipboard-image-writer)\.ts$/.test(file) ||
    file === "src/main/local-store/config.ts" ||
    file === "src/main/logging/logger.ts"
  ) {
    return "electron-proxy";
  }
  if (file.startsWith("src/main/") || file.startsWith("src/shared/")) {
    return "port-to-core";
  }
  return "obsolete-remove";
};

const capabilityFor = (file: string): Capability | null => {
  const rule = capabilityRules.find((candidate) => candidate.pattern.test(file));
  if (!rule) return null;
  return {
    module: rule.module,
    intent: migrationOnly(file)
      ? `retire the v82-only implementation after ${rule.intent}`
      : rule.intent,
    callerNeed: rule.callerNeed,
  };
};

const sqlStrings = (file: string, content: string): readonly string[] => {
  const source = ts.createSourceFile(
    file,
    content,
    ts.ScriptTarget.Latest,
    false,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const strings: string[] = [];
  const visit = (node: ts.Node): void => {
    let value: string | null = null;
    if (ts.isStringLiteralLike(node)) {
      value = node.text;
    } else if (ts.isTemplateExpression(node)) {
      value = [
        node.head.text,
        ...node.templateSpans.map((span) => ` __EXPR__ ${span.literal.text}`),
      ].join("");
    }
    const candidate = value?.trimStart() ?? "";
    const startsWithSql =
      /^(?:SELECT\b[\s\S]*\bFROM\b|WITH\b[\s\S]*\bSELECT\b|INSERT\s+INTO\b|UPDATE\b[\s\S]*\bSET\b|DELETE\s+FROM\b|CREATE\s+(?:VIRTUAL\s+)?TABLE\b|ALTER\s+TABLE\b|DROP\s+TABLE\b|PRAGMA\b)/i.test(
        candidate,
      );
    if (value && startsWithSql) {
      strings.push(value);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return strings;
};

const knownSqlTables = new Set<string>([
  "sqlite_master",
  "sqlite_schema",
  "sqlite_sequence",
  "pragma_foreign_key_check",
  "pragma_table_info",
  "pragma_index_list",
  "pragma_index_info",
]);
for (const file of productionFiles) {
  const content = read(file);
  for (const sql of sqlStrings(file, content)) {
    for (const match of sql.matchAll(
      /\bCREATE\s+(?:VIRTUAL\s+)?TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+([a-z_][a-z0-9_]*)/gi,
    )) {
      const table = match[1]?.toLowerCase();
      if (table) knownSqlTables.add(table);
    }
  }
}

const sqlTables = (file: string, content: string): readonly string[] => {
  const tables = new Set<string>();
  for (const sql of sqlStrings(file, content)) {
    const commonTableExpressions = new Set(
      Array.from(
        sql.matchAll(
          /(?:\bWITH\s+(?:RECURSIVE\s+)?|,)\s*([a-z_][a-z0-9_]*)\s+AS\s*\(/gi,
        ),
        (match) => match[1]?.toLowerCase(),
      ).filter((value): value is string => Boolean(value)),
    );
    for (const match of sql.matchAll(
      /\b(?:FROM|JOIN|INSERT\s+INTO|UPDATE|DELETE\s+FROM|CREATE\s+(?:VIRTUAL\s+)?TABLE(?:\s+IF\s+NOT\s+EXISTS)?|ALTER\s+TABLE|DROP\s+TABLE(?:\s+IF\s+EXISTS)?|REFERENCES)\s+([a-z_][a-z0-9_]*)/gi,
    )) {
      const table = match[1]?.toLowerCase();
      if (
        table &&
        knownSqlTables.has(table) &&
        table !== "set" &&
        table !== "__expr__" &&
        !commonTableExpressions.has(table)
      ) {
        tables.add(table);
      }
    }
  }
  return [...tables].sort();
};

const evidenceFor = (
  content: string,
  classification: Classification,
): readonly string[] => {
  if (classification === "renderer-only") {
    return [
      "authorization: delegated to Core",
      "receipt: none in renderer",
      "events: consumes committed Core notifications",
    ];
  }
  if (classification === "electron-proxy") {
    return [
      "authorization: bound host/client identity",
      "receipt: pass-through only",
      "events: relay only",
    ];
  }
  const authorization = /resource_grants|authorize|authorization|document-access/.test(
    content,
  )
    ? "authorization: Resource Authorization or durable grants"
    : /projectId|project_id|libraryId|storeEpoch|store_epoch/.test(content)
      ? "authorization: Project/Library/store-epoch scope"
      : "authorization: owning Module policy (not visible in this file)";
  const receipt = /receipt|idempotenc|operationId|operation_id|updateId|update_id/i.test(
    content,
  )
    ? "receipt: durable receipt or idempotency key"
    : "receipt: none visible in this file";
  const events = /dbNotifier|change_log|committed event|notifyChange|emit\(/i.test(
    content,
  )
    ? "events: projection or post-commit publication"
    : "events: none visible in this file";
  return [authorization, receipt, events];
};

const nearestTest = (file: string): string | null => {
  if (!/\.tsx?$/.test(file)) return null;
  const candidates = [
    file.replace(/\.tsx?$/, ".test.ts"),
    file.replace(/\.tsx?$/, ".test.tsx"),
  ];
  return candidates.find((candidate) => trackedFiles.includes(candidate)) ?? null;
};

const moduleOracle: Readonly<Record<Module, string>> = {
  Adapter: "src/main/http-server-start.test.ts",
  Automation: "src/main/local-store/codex-scheduled-automations.test.ts",
  Database: "src/main/local-store/database-module-v2-runtime.test.ts",
  Library: "src/main/local-store/library-module-runtime.test.ts",
  "Owned Document": "src/main/local-store/block-document-store.test.ts",
  "Project Workspace": "src/main/local-store/project-sessions.test.ts",
  "Store Administration": "src/main/local-store/backups.test.ts",
};

const entries: InventoryEntry[] = [];
const unclassifiedFiles: string[] = [];
for (const file of productionFiles) {
  const content = read(file);
  const surfaces = surfaceRules
    .filter((rule) => rule.matches(file, content))
    .map((rule) => rule.name);
  if (surfaces.length === 0) continue;
  const capability = capabilityFor(file);
  if (!capability) {
    unclassifiedFiles.push(file);
    continue;
  }
  const classification = classify(file);
  entries.push({
    file,
    surfaces,
    classification,
    ...capability,
    tables: sqlTables(file, content),
    evidence: evidenceFor(content, classification),
    test: nearestTest(file) ?? moduleOracle[capability.module],
  });
}

const workerCommandRules: readonly CapabilityRule[] = [
  {
    pattern: /(?:DatabaseModule|BlockProperty)/,
    module: "Database",
    intent: "read or apply a typed Database Module operation",
    callerNeed: "Database consumers need schema/value/ranking semantics",
  },
  {
    pattern: /(?:Occurrence)/,
    module: "Automation",
    intent: "advance a scheduled Page occurrence",
    callerNeed: "the scheduler needs idempotent occurrence transitions",
  },
  {
    pattern: /^maintainStoreBlockRetention$/,
    module: "Store Administration",
    intent: "run durable Block retention under the store maintenance policy",
    callerNeed: "retention must preserve ownership, history, receipts, and recovery invariants",
  },
  {
    pattern: /^(?:deleteProject)$/,
    module: "Project Workspace",
    intent: "delete a Project execution context atomically",
    callerNeed: "Project cleanup must coordinate persisted execution state",
  },
  {
    pattern: /(?:Document|Canvas)/,
    module: "Owned Document",
    intent: "read, prepare, synchronize, mutate, relocate, or maintain owned Documents",
    callerNeed: "document clients need atomic CRDT heads, receipts, projections, and history",
  },
  {
    pattern: /(?:Library|Page|NodexAgent|Relocation|BlockTransfer|relocate)/,
    module: "Library",
    intent: "read, prepare, or apply a Library Page/Block operation",
    callerNeed: "Library clients need authorized semantic content and lifecycle operations",
  },
  {
    pattern: /^(?:shutdown|writerBarrier|log)$/,
    module: "Store Administration",
    intent: "control or observe the serialized authority runtime",
    callerNeed: "trusted lifecycle code needs bounded drain, barrier, and diagnostic control",
  },
];

const workerProtocol = read("src/main/block-mutation-worker-protocol.ts");
const workerCommandNames = [
  ...new Set(
    Array.from(workerProtocol.matchAll(/type: "([^"]+)"/g), (match) => match[1]),
  ),
].sort();
const unclassifiedCommands: string[] = [];
const workerCommands: WorkerCommandEntry[] = workerCommandNames.flatMap(
  (command) => {
    const rule = workerCommandRules.find((candidate) =>
      candidate.pattern.test(command),
    );
    if (!rule) {
      unclassifiedCommands.push(command);
      return [];
    }
    return [
      {
        command,
        module: rule.module,
        intent: rule.intent,
        callerNeed: rule.callerNeed,
      },
    ];
  },
);

if (unclassifiedFiles.length > 0 || unclassifiedCommands.length > 0) {
  throw new Error(
    [
      "Rust Core authority inventory is incomplete.",
      ...(unclassifiedFiles.length > 0
        ? [`Unclassified files:\n${unclassifiedFiles.join("\n")}`]
        : []),
      ...(unclassifiedCommands.length > 0
        ? [`Unclassified worker commands:\n${unclassifiedCommands.join("\n")}`]
        : []),
    ].join("\n\n"),
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

const sortedEntries = [...entries].sort((left, right) =>
  left.file.localeCompare(right.file),
);
const inventory = `# Rust Core authority inventory

Generated by \`pnpm run core:authority:inventory\`. The inventory is evidence for migration planning; classifications describe the target owner, not the current implementation. Source discovery is limited to tracked production TypeScript/JavaScript files. Store owners and imports are enumerated independently of keyword matching; SQL tables come only from parsed source string/template nodes. Generation fails when a discovered file or worker discriminant has no semantic assignment.

- Legacy cutover schema: ${schemaVersion}
- Production authority/adapter files: ${entries.length}
- Direct database files: ${entries.filter((entry) => entry.surfaces.includes("sqlite")).length}
- Authority-side Yjs/y-protocol files: ${entries.filter((entry) => entry.surfaces.includes("yjs-authority") && entry.classification !== "renderer-only").length}
- Worker command discriminants: ${workerCommands.length}
- Unclassified files/commands: 0

| File | Surfaces | Classification | Target Module | Semantic capability | Why callers need it | Hidden SQL tables | Auth / receipt / event evidence | Nearest behavior test |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
${sortedEntries
  .map(
    (entry) =>
      `| ${escapeCell(entry.file)} | ${renderList(entry.surfaces)} | ${entry.classification} | ${entry.module} | ${escapeCell(entry.intent)} | ${escapeCell(entry.callerNeed)} | ${renderList(entry.tables)} | ${renderList(entry.evidence)} | ${entry.test ?? "—"} |`,
  )
  .join("\n")}

## Worker command assignments

The current worker surface is migration evidence, not the target UDS API. Every discriminant is assigned to an owning deep Module semantic capability or trusted runtime control; none becomes a route merely because the old worker exposed it.

| Worker command | Target Module | Semantic capability | Why callers need it |
| --- | --- | --- | --- |
${workerCommands
  .map(
    (entry) =>
      `| \`${entry.command}\` | ${entry.module} | ${escapeCell(entry.intent)} | ${escapeCell(entry.callerNeed)} |`,
  )
  .join("\n")}
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

## Inventory assignment counts

${Object.entries(
  sortedEntries.reduce<Record<string, number>>((counts, entry) => {
    counts[entry.module] = (counts[entry.module] ?? 0) + 1;
    return counts;
  }, {}),
)
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([module, count]) => `- ${module}: ${count} production files`)
  .join("\n")}

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
writeFileSync(
  path.join(outputRoot, "authority-inventory.json"),
  `${JSON.stringify(
    {
      schemaVersion: Number(schemaVersion),
      generatedAt: new Date().toISOString(),
      entries: sortedEntries,
      workerCommands,
      unclassified: { files: [], workerCommands: [] },
    },
    null,
    2,
  )}\n`,
);

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
    unclassified: 0,
  }),
);
