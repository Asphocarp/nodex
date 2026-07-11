import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const require = createRequire(import.meta.url);
const electronExecutable = require("electron");
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.join(repositoryRoot, ".generated/block-first/probes");
const external = ["better-sqlite3", "electron"];

const probes = [
  "block-first-runtime-probe",
  "block-first-secondary-schema-runtime-probe",
  "block-first-card-read-runtime-probe",
  "block-first-scheduler-runtime-probe",
  "block-first-card-behavior-schema-runtime-probe",
  "block-first-property-mutation-runtime-probe",
  "block-first-property-worker-runtime-probe",
  "block-first-card-lifecycle-runtime-probe",
  "block-first-card-lifecycle-worker-runtime-probe",
  "block-first-projection-runtime-probe",
  "block-first-document-projection-runtime-probe",
  "block-first-document-operation-runtime-probe",
  "block-first-document-operation-transport-runtime-probe",
  "block-first-store-maintenance-runtime-probe",
  "block-first-database-kernel-runtime-probe",
  "block-first-database-transport-runtime-probe",
  "block-first-database-bulk-drag-runtime-probe",
  "block-first-additional-documents-runtime-probe",
  "block-first-canvas-document-runtime-probe",
  "block-first-document-version-runtime-probe",
  "block-first-document-compaction-runtime-probe",
  "block-first-card-clone-runtime-probe",
  "block-first-synced-block-runtime-probe",
  "block-first-foreign-reference-runtime-probe",
  "block-first-relocation-schema-runtime-probe",
  "block-first-relocation-runtime-probe",
  "block-first-relocation-worker-runtime-probe",
  "block-first-additional-document-command-runtime-probe",
  "block-first-additional-document-command-worker-runtime-probe",
  "block-first-block-retention-gc-runtime-probe",
  "block-first-card-history-runtime-probe",
  "block-first-database-view-snapshot-runtime-probe",
  "block-first-card-project-transfer-runtime-probe",
];

const workerProbes = new Set([
  "block-first-property-worker-runtime-probe",
  "block-first-card-lifecycle-worker-runtime-probe",
  "block-first-document-operation-transport-runtime-probe",
  "block-first-store-maintenance-runtime-probe",
  "block-first-database-transport-runtime-probe",
  "block-first-relocation-worker-runtime-probe",
  "block-first-additional-document-command-worker-runtime-probe",
]);

const requestedProbes = process.argv.slice(2).filter((argument) => argument !== "--");
const selectedProbes =
  requestedProbes.length === 0
    ? probes
    : requestedProbes.map((requestedProbe) => {
        if (probes.includes(requestedProbe)) return requestedProbe;
        throw new Error(`Unknown Block-first runtime probe: ${requestedProbe}`);
      });

async function bundle(entryPoint, outfile, format) {
  await build({
    absWorkingDir: repositoryRoot,
    bundle: true,
    entryPoints: [entryPoint],
    external,
    format,
    logLevel: "warning",
    outfile,
    platform: "node",
    target: "node24",
  });
}

function runProbe(probePath) {
  const result = spawnSync(electronExecutable, [probePath], {
    cwd: repositoryRoot,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", NODE_ENV: "test" },
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status === 0) return;
  throw new Error(`Runtime probe failed: ${path.basename(probePath)} (exit ${result.status ?? "unknown"})`);
}

fs.mkdirSync(outputDir, { recursive: true });
await bundle(
  "src/main/card-mutation-worker.ts",
  path.join(outputDir, "card-mutation-worker.js"),
  "cjs",
);

for (const probe of selectedProbes) {
  const isWorkerProbe = workerProbes.has(probe);
  const extension = isWorkerProbe ? "mjs" : "cjs";
  const outfile = path.join(outputDir, `${probe}.${extension}`);
  await bundle(`scripts/${probe}.ts`, outfile, isWorkerProbe ? "esm" : "cjs");
  runProbe(outfile);
}
