import { expect, test } from "@playwright/test";
import {
  _electron as electron,
  type CDPSession,
  type ElectronApplication,
  type Locator,
  type Page,
} from "playwright";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "vite";
import {
  createRendererVitePlugins,
  rendererViteCss,
  rendererViteResolve,
} from "../../config/renderer-vite-shared";
import { CoreClient } from "../../src/main/core-client/core-client";
import { LARGE_CONTENT_FIXTURE_SIZES } from "../../src/main/performance/large-content-fixtures";
import {
  AGENT_RUNTIME_LAYOUT_VERSION,
  parseBundledAgentRuntimeMetadata,
} from "../../src/shared/codex-runtime-metadata";
import { DATABASE_MODULE_V2_CONTRACT_VERSION } from "../../src/shared/database-module-v2";
import {
  compilePageLifecycleRequestV2,
  type PageLifecyclePreflightSnapshotV2,
} from "../../src/shared/page-lifecycle-v2-runtime";
import { LIBRARY_MODULE_CONTRACT_VERSION } from "../../src/shared/library-module";
import { createUuidV7 } from "../../src/shared/uuid-v7";

const repositoryRoot = process.cwd();
const largeContentFixtureRoot = path.join(repositoryRoot, "tests/e2e/large-content-fixture");
const largeContentElectronMain = path.join(largeContentFixtureRoot, "electron-main.cjs");

type LargeContentScenario = "license" | "workspace" | "markdown" | "tool" | "startup";

interface LargeContentScenarioMetrics {
  scenario: LargeContentScenario;
  maxLongTaskMs: number;
  traceMaxRunTaskMs: number;
  domNodes: number;
  accessibilityNodes: number;
  tracePath: string;
  traceBytes: number;
  traceSha256: string;
}

interface ConvergenceProject {
  projectId: string;
  storeEpoch: string;
  defaultDatabaseViewId: string;
}

interface ConvergencePage {
  pageId: string;
  documentId: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const requireString = (value: unknown, label: string): string => {
  if (typeof value === "string" && value.length > 0) return value;
  throw new Error(`${label} is missing from the Electron E2E response`);
};

const requireIpcValue = <T>(result: unknown, label: string): T => {
  if (!isRecord(result) || result.ok !== true || !("value" in result)) {
    const error = isRecord(result) && isRecord(result.error)
      ? String(result.error.message ?? "unknown IPC error")
      : "unknown IPC error";
    throw new Error(`${label} failed: ${error}`);
  }
  return result.value as T;
};

async function invokeIpc(
  page: Page,
  channel: string,
  ...args: readonly unknown[]
): Promise<unknown> {
  return await page.evaluate(
    async ({ channel: targetChannel, args: targetArgs }) =>
      await window.api?.invoke(targetChannel, ...targetArgs),
    { channel, args },
  );
}

async function createConvergenceProject(
  page: Page,
  name: string,
  workspace: string,
): Promise<ConvergenceProject> {
  const project = await invokeIpc(page, "projects:create", {
    name,
    sources: [workspace],
  });
  if (!isRecord(project)) throw new Error("Project creation returned no Project");
  const projectId = requireString(project.id, "Project id");
  const defaultDatabaseViewId = requireString(
    project.defaultDatabaseViewId,
    "Project default Database View id",
  );
  const metadata = requireIpcValue<Record<string, unknown>>(
    await invokeIpc(
      page,
      "library-module:read",
      { kind: "library" },
      {
        version: LIBRARY_MODULE_CONTRACT_VERSION,
        read: { mode: "metadata" },
      },
    ),
    "Library metadata read",
  );
  return {
    projectId,
    defaultDatabaseViewId,
    storeEpoch: requireString(metadata.storeEpoch, "Library store epoch"),
  };
}

async function createConvergencePage(
  page: Page,
  project: ConvergenceProject,
  title: string,
): Promise<ConvergencePage> {
  const pageId = createUuidV7();
  const documentId = createUuidV7();
  const result = requireIpcValue<Record<string, unknown>>(
    await invokeIpc(
      page,
      "library-module:apply",
      { kind: "library" },
      {
        version: LIBRARY_MODULE_CONTRACT_VERSION,
        operationId: createUuidV7(),
        storeEpoch: project.storeEpoch,
        operation: {
          kind: "create_page",
          pageId,
          documentId,
          title,
          parent: { kind: "library" },
        },
      },
    ),
    `Create ${title}`,
  );
  const createdTarget = result.createdTarget;
  if (!isRecord(createdTarget)) {
    throw new Error(`Create ${title} returned no Page target`);
  }
  expect(createdTarget.kind).toBe("page");
  expect(requireString(createdTarget.pageId, `${title} Page id`)).toBe(pageId);
  await requireIpcValue<Record<string, unknown>>(
    await invokeIpc(
      page,
      "library-module:apply",
      { kind: "library" },
      {
        version: LIBRARY_MODULE_CONTRACT_VERSION,
        operationId: createUuidV7(),
        storeEpoch: project.storeEpoch,
        operation: {
          kind: "grant_project_access",
          projectId: project.projectId,
          target: { kind: "page", pageId },
          access: "read_write",
        },
      },
    ),
    `Grant ${title}`,
  );
  return { pageId, documentId };
}

async function createConvergenceBoardPage(
  page: Page,
  project: ConvergenceProject,
  title: string,
  description: string,
): Promise<ConvergencePage> {
  const pageId = createUuidV7();
  const preflight = requireIpcValue<PageLifecyclePreflightSnapshotV2>(
    await invokeIpc(page, "pages:lifecycle:preflight", project.projectId, pageId),
    `Preflight ${title}`,
  );
  const request = compilePageLifecycleRequestV2({
    intent: {
      kind: "create",
      operationId: createUuidV7(),
      projectId: project.projectId,
      pageId,
      status: "triage",
      input: {
        id: pageId,
        title,
        description,
      },
    },
    preflight,
  });
  const receipt = requireIpcValue<Record<string, unknown>>(
    await invokeIpc(page, "pages:lifecycle:apply", project.projectId, request),
    `Create Board Page ${title}`,
  );
  return {
    pageId,
    documentId: requireString(receipt.documentId, `${title} document id`),
  };
}

interface SeededConvergencePage extends ConvergencePage {
  blockIds: readonly string[];
}

async function seedConvergenceDocument(
  page: Page,
  project: ConvergenceProject,
  source: ConvergencePage,
  nfm = "Keep block\nDragged source",
): Promise<SeededConvergencePage> {
  const descriptor = requireIpcValue<Record<string, unknown>>(
    await invokeIpc(
      page,
      "block-document:owned:prepare",
      project.projectId,
      source.pageId,
    ),
    "Prepare source Page document",
  );
  const documentId = requireString(descriptor.documentId, "Source document id");
  if (documentId !== source.documentId) {
    throw new Error("Source Page document identity changed during preparation");
  }

  const mutation = requireIpcValue<Record<string, unknown>>(
    await invokeIpc(
      page,
      "block-documents:mutate",
      project.projectId,
      documentId,
      {
        version: 1,
        mutationId: createUuidV7(),
        projectId: project.projectId,
        storeEpoch: project.storeEpoch,
        actor: {},
        documentId,
        generation: descriptor.generation,
        expectedHeadSeq: descriptor.headSeq,
        nfm,
      },
    ),
    "Seed source Page document",
  );
  if (!Array.isArray(mutation.createdBlockIds)) {
    throw new Error("Seed source Page document returned no created block ids");
  }
  const blockIds = mutation.createdBlockIds.map((blockId, index) =>
    requireString(blockId, `Seeded block id ${index}`),
  );
  if (blockIds.length < 2) {
    throw new Error("Seed source Page document must contain a transferable block");
  }
  return { ...source, blockIds };
}

async function dragBlockToBoardWithMouse({
  page,
  sourceBlock,
  sourceEditor,
  targetColumn,
}: {
  page: Page;
  sourceBlock: Locator;
  sourceEditor: Locator;
  targetColumn: Locator;
}): Promise<void> {
  await sourceBlock.scrollIntoViewIfNeeded();
  const sourceBlockContent = sourceBlock.locator(":scope > .bn-block-content");
  await expect(sourceBlockContent).toBeVisible();
  await sourceBlockContent.hover();

  // A parent Block's outer box includes its children, so hover its direct
  // content to reveal the correct dynamic handle. Keep that same connected node
  // stable for two frames before pressing it; a remount aborts native DnD.
  const dragHandle = sourceEditor.locator(
    '.bn-side-menu button[draggable="true"]:visible',
  );
  await expect(dragHandle).toHaveCount(1);
  await expect(dragHandle).toBeVisible();
  const handleCenter = await dragHandle.evaluate(async (handle) => {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
    if (!handle.isConnected) {
      throw new Error("Block drag handle remounted before mouse down");
    }
    const box = handle.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) {
      throw new Error("Block drag handle has no layout box");
    }
    return {
      x: box.x + box.width / 2,
      y: box.y + box.height / 2,
    };
  });

  await page.mouse.move(handleCenter.x, handleCenter.y);
  await page.mouse.down();
  let mouseReleased = false;
  try {
    // This first segment crosses both Nodex's click tolerance and Chromium's
    // native drag activation threshold before the long trip to the Board.
    await page.mouse.move(handleCenter.x + 12, handleCenter.y, { steps: 4 });

    const columnBox = await targetColumn.boundingBox();
    if (!columnBox) throw new Error("Board target column has no layout box");
    const dropPoint = {
      x: columnBox.x + columnBox.width / 2,
      y: columnBox.y + Math.min(
        columnBox.height - 12,
        Math.max(64, columnBox.height * 0.7),
      ),
    };
    await page.mouse.move(dropPoint.x, dropPoint.y, { steps: 30 });

    // The first target move may emit only dragenter. Two tiny in-target moves
    // reliably produce the accepted dragover required for an HTML5 drop.
    await page.mouse.move(dropPoint.x + 1, dropPoint.y + 1);
    await page.mouse.move(dropPoint.x + 2, dropPoint.y + 2);
    await page.mouse.up();
    mouseReleased = true;
  } finally {
    // Deliberately do not retry: a failed gesture may already have committed.
    if (!mouseReleased) await page.mouse.up().catch(() => undefined);
  }
}

async function dragListRowWithMouse({
  page,
  sourceRow,
  targetRow,
  position,
}: {
  page: Page;
  sourceRow: Locator;
  targetRow: Locator;
  position: "before" | "after" | "nest";
}): Promise<void> {
  await sourceRow.scrollIntoViewIfNeeded();
  await sourceRow.hover();
  await expect(sourceRow).toHaveAttribute("draggable", "true");
  const dragSurface = sourceRow.locator('[data-list-grid-column="identifier"]');
  const handleBox = await dragSurface.boundingBox();
  if (!handleBox) throw new Error("List row drag surface has no layout box");
  const sourcePoint = {
    x: handleBox.x + handleBox.width / 2,
    y: handleBox.y + handleBox.height / 2,
  };
  const targetBox = await targetRow.boundingBox();
  if (!targetBox) throw new Error("List target row has no layout box");
  const targetRatio = position === "before" ? 0.14 : position === "after" ? 0.86 : 0.5;
  const targetPoint = {
    x: targetBox.x + Math.min(targetBox.width - 24, Math.max(80, targetBox.width * 0.45)),
    y: targetBox.y + targetBox.height * targetRatio,
  };

  await page.mouse.move(sourcePoint.x, sourcePoint.y);
  await page.mouse.down();
  let mouseReleased = false;
  try {
    await page.mouse.move(sourcePoint.x + 12, sourcePoint.y, { steps: 4 });
    await page.mouse.move(targetPoint.x, targetPoint.y, { steps: 24 });
    await page.mouse.move(targetPoint.x + 1, targetPoint.y);
    await page.mouse.move(targetPoint.x + 2, targetPoint.y);
    await page.mouse.up();
    mouseReleased = true;
  } finally {
    if (!mouseReleased) await page.mouse.up().catch(() => undefined);
  }
}

interface ConvergenceDatabase {
  dataSourceId: string;
  viewId: string;
}

interface BoardTransferPerformanceMetrics {
  fixtureSeed: string;
  buildMode: string;
  platform: string;
  architecture: string;
  osRelease: string;
  cpuModel: string;
  cpuCount: number;
  totalMemoryBytes: number;
  normalizedOneMinuteLoadAtStart: number;
  normalizedOneMinuteLoadMax: number;
  fixturePreparationMs: number;
  boardInitialRenderMs: number;
  transferCommitMs: number;
  transferToSourceRemovalMs: number;
  transferToCardMs: number;
  endToEndMs: number;
  sourceBlockCount: number;
  movedChildBlockCount: number;
  initialBoardPageCount: number;
  finalBoardPageCount: number;
  initialRenderedBoardCardCount: number;
  finalRenderedBoardCardCount: number;
  initialDomNodes: number;
  finalDomNodes: number;
  rendererLongTaskCount: number;
  rendererLongTaskTotalMs: number;
  rendererMaxLongTaskMs: number;
  peakWorkingSetBytes: number;
  firstTransferVisibilityFacts: Array<{
    relationKind: string;
    operation: string;
    count: number;
  }>;
  firstTransferVisibilityRows: Array<{
    relationKind: string;
    operation: string;
    oldRow: string | null;
    newRow: string | null;
  }>;
  transferCommitP50Ms: number;
  transferCommitP95Ms: number;
  transferCommitP99Ms: number | null;
  transferCommitMaxMs: number;
  transferToSourceRemovalP50Ms: number;
  transferToSourceRemovalP95Ms: number;
  transferToSourceRemovalP99Ms: number | null;
  transferToSourceRemovalMaxMs: number;
  transferToCardP50Ms: number;
  transferToCardP95Ms: number;
  transferToCardP99Ms: number | null;
  transferToCardMaxMs: number;
  coreStages: Record<CoreTransferStage, CoreTransferStageSummary>;
  rawSamples: {
    transferCommitMs: number[];
    transferToSourceRemovalMs: number[];
    transferToCardMs: number[];
    normalizedOneMinuteLoad: number[];
    coreStages: Record<CoreTransferStage, number[]>;
  };
  rounds: number;
}

type CoreHealthMetrics = Awaited<ReturnType<CoreClient["health"]>>["metrics"];

const CORE_TRANSFER_STAGES = {
  writerQueueWait: "writer_queue_wait",
  writerExecution: "writer_execution",
  transaction: "transaction_duration",
  prepare: "block_transfer_prepare_duration",
  reconstruct: "block_transfer_reconstruct_duration",
  decode: "block_transfer_decode_duration",
  transform: "block_transfer_transform_duration",
  encode: "block_transfer_encode_duration",
  apply: "block_transfer_apply_duration",
  packetPublication: "local_commit_publication_duration",
} as const satisfies Record<string, keyof CoreHealthMetrics>;

type CoreTransferStage = keyof typeof CORE_TRANSFER_STAGES;

interface CoreTransferStageSummary {
  p50Ms: number;
  p95Ms: number;
  p99Ms: number | null;
  maxMs: number;
  observationCount: number;
}

const HIGH_PRESSURE_SIBLING_BLOCK_COUNT = 100;
const HIGH_PRESSURE_CHILD_BLOCK_COUNT = 100;
const HIGH_PRESSURE_BOARD_PAGE_COUNT = 100;
const HIGH_PRESSURE_BOARD_TRIAGE_PAGE_COUNT = 50;
const HIGH_PRESSURE_BOARD_PLAN_PAGE_COUNT =
  HIGH_PRESSURE_BOARD_PAGE_COUNT - HIGH_PRESSURE_BOARD_TRIAGE_PAGE_COUNT;
const HIGH_PRESSURE_SOURCE_REMAINDER = [
  ...Array.from(
    { length: HIGH_PRESSURE_SIBLING_BLOCK_COUNT },
    (_, index) => `before-placeholder-${index.toString().padStart(3, "0")}`,
  ),
  ...Array.from(
    { length: HIGH_PRESSURE_SIBLING_BLOCK_COUNT },
    (_, index) => `after-placeholder-${index.toString().padStart(3, "0")}`,
  ),
].join(" ");
const HIGH_PRESSURE_ROUNDS = Math.max(
  1,
  Math.min(
    100,
    Number.parseInt(process.env.NODEX_HIGH_PRESSURE_ROUNDS ?? "1", 10) || 1,
  ),
);
const HIGH_PRESSURE_TEST_TIMEOUT_MS =
  180_000 + Math.max(0, HIGH_PRESSURE_ROUNDS - 1) * 2_000;
const PAGE_READY_HISTORY_COMMITS = 14_419;
const PAGE_READY_ROUNDS = 20;
const IDLE_CPU_SAMPLE_SECONDS = Math.max(
  1,
  Math.min(
    60,
    Number.parseInt(process.env.NODEX_IDLE_CPU_SAMPLE_SECONDS ?? "60", 10) || 60,
  ),
);

const buildHighPressureSourceNfm = (titlePrefix = "title-A"): string => [
  ...Array.from(
    { length: HIGH_PRESSURE_SIBLING_BLOCK_COUNT },
    (_, index) => `before-placeholder-${index.toString().padStart(3, "0")}`,
  ),
  titlePrefix,
  ...Array.from(
    { length: HIGH_PRESSURE_CHILD_BLOCK_COUNT },
    (_, index) => `\tchild-placeholder-${index.toString().padStart(3, "0")}`,
  ),
  ...Array.from(
    { length: HIGH_PRESSURE_SIBLING_BLOCK_COUNT },
    (_, index) => `after-placeholder-${index.toString().padStart(3, "0")}`,
  ),
].join("\n");

function readVisibilityFactCounts(
  nodexHome: string,
  commitSeq: number,
): BoardTransferPerformanceMetrics["firstTransferVisibilityFacts"] {
  const raw = execFileSync(
    "sqlite3",
    [
      "-json",
      path.join(nodexHome, "nodex.db"),
      `SELECT relation_kind AS relationKind, operation, count(*) AS count
       FROM local_commit_visibility_dirty_facts
       WHERE commit_seq = ${commitSeq}
       GROUP BY relation_kind, operation
       ORDER BY relation_kind, operation`,
    ],
    { encoding: "utf8" },
  ).trim();
  if (!raw) return [];
  const rows: unknown = JSON.parse(raw);
  if (!Array.isArray(rows)) {
    throw new Error("Visibility fact evidence is not an array");
  }
  return rows.map((row) => {
    if (
      !isRecord(row)
      || typeof row.relationKind !== "string"
      || typeof row.operation !== "string"
      || typeof row.count !== "number"
    ) {
      throw new Error("Visibility fact evidence is invalid");
    }
    return {
      relationKind: row.relationKind,
      operation: row.operation,
      count: row.count,
    };
  });
}

function readVisibilityFactRows(
  nodexHome: string,
  commitSeq: number,
): BoardTransferPerformanceMetrics["firstTransferVisibilityRows"] {
  const raw = execFileSync(
    "sqlite3",
    [
      "-json",
      path.join(nodexHome, "nodex.db"),
      `SELECT relation_kind AS relationKind, operation,
              old_row_json AS oldRow, new_row_json AS newRow
       FROM local_commit_visibility_dirty_facts
       WHERE commit_seq = ${commitSeq}
       ORDER BY fact_seq`,
    ],
    { encoding: "utf8" },
  ).trim();
  if (!raw) return [];
  const rows: unknown = JSON.parse(raw);
  if (!Array.isArray(rows)) {
    throw new Error("Visibility fact row evidence is not an array");
  }
  return rows.map((row) => {
    if (
      !isRecord(row)
      || typeof row.relationKind !== "string"
      || typeof row.operation !== "string"
      || (row.oldRow !== null && typeof row.oldRow !== "string")
      || (row.newRow !== null && typeof row.newRow !== "string")
    ) {
      throw new Error("Visibility fact row evidence is invalid");
    }
    return {
      relationKind: row.relationKind,
      operation: row.operation,
      oldRow: row.oldRow,
      newRow: row.newRow,
    };
  });
}

const summarizeDurations = (values: readonly number[]): {
  p50: number;
  p95: number;
  p99: number | null;
  max: number;
} => {
  if (values.length === 0) {
    throw new Error("Performance sample set cannot be empty");
  }
  const sorted = [...values].sort((left, right) => left - right);
  const percentile = (fraction: number): number =>
    sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
  return {
    p50: percentile(0.5),
    p95: percentile(0.95),
    p99: values.length >= 100 ? percentile(0.99) : null,
    max: sorted.at(-1) ?? 0,
  };
};

const durationMetricDelta = (
  before: CoreHealthMetrics,
  after: CoreHealthMetrics,
  key: (typeof CORE_TRANSFER_STAGES)[CoreTransferStage],
): { durationMs: number; observationCount: number } => {
  const beforeMetric = before[key];
  const afterMetric = after[key];
  if (!isRecord(beforeMetric) || !isRecord(afterMetric)) {
    throw new Error(`Core health metric ${key} is unavailable`);
  }
  const beforeTotal = beforeMetric.total_micros;
  const afterTotal = afterMetric.total_micros;
  const beforeCount = beforeMetric.count;
  const afterCount = afterMetric.count;
  if (
    typeof beforeTotal !== "number"
    || typeof afterTotal !== "number"
    || typeof beforeCount !== "number"
    || typeof afterCount !== "number"
    || afterTotal < beforeTotal
    || afterCount < beforeCount
  ) {
    throw new Error(`Core health metric ${key} moved backwards`);
  }
  return {
    durationMs: (afterTotal - beforeTotal) / 1_000,
    observationCount: afterCount - beforeCount,
  };
};

const buildBoardFixtureNfm = (): string => [
  "Keep board fixture",
  ...Array.from(
    { length: HIGH_PRESSURE_BOARD_PAGE_COUNT },
    (_, index) => `board-fixture-${index.toString().padStart(3, "0")}`,
  ),
].join("\n");

interface SyntheticHistoryResult {
  readonly commitCountBefore: number;
  readonly commitCountAfter: number;
  readonly commitHeadAfter: number;
  readonly storeVersion: number;
  readonly databaseBytes: number;
}

const sqliteScalarRow = (databasePath: string, query: string): readonly string[] =>
  execFileSync(
    "sqlite3",
    ["-batch", "-noheader", "-separator", "|", databasePath, query],
    { encoding: "utf8" },
  ).trim().split("|");

const requireSafeInteger = (value: string | undefined, label: string): number => {
  const parsed = Number.parseInt(value ?? "", 10);
  if (Number.isSafeInteger(parsed) && parsed >= 0) return parsed;
  throw new Error(`${label} is not a non-negative safe integer`);
};

function seedSyntheticLocalCommitHistory(
  nodexHome: string,
  targetCommitCount: number,
): SyntheticHistoryResult {
  const databasePath = path.join(nodexHome, "nodex.db");
  const [rawCount, rawHead, storeEpoch, rawVersion] = sqliteScalarRow(
    databasePath,
    "SELECT count(*), COALESCE(max(commit_seq), 0), "
      + "(SELECT store_epoch FROM block_store_metadata WHERE id = 1), "
      + "(SELECT user_version FROM pragma_user_version) FROM local_commits;",
  );
  const commitCountBefore = requireSafeInteger(rawCount, "History commit count");
  const commitHeadBefore = requireSafeInteger(rawHead, "History commit head");
  const storeVersion = requireSafeInteger(rawVersion, "History Store version");
  if (!storeEpoch) throw new Error("History fixture Store epoch is missing");
  if (commitCountBefore >= targetCommitCount) {
    throw new Error("History fixture already meets or exceeds its target");
  }
  const missing = targetCommitCount - commitCountBefore;
  const finalCommitSeq = commitHeadBefore + missing;
  const sql = `
PRAGMA foreign_keys = ON;
BEGIN IMMEDIATE;
WITH RECURSIVE fixture_seq(commit_seq) AS (
  SELECT ${commitHeadBefore + 1}
  UNION ALL
  SELECT commit_seq + 1 FROM fixture_seq WHERE commit_seq < ${finalCommitSeq}
)
INSERT INTO local_commits(
  commit_seq, store_epoch, operation_id, committed_at,
  projection_impact_json, canonical_hash, intent_hash, projection_json,
  receipt_json, audience_json, finalized, manifest_json
)
SELECT
  commit_seq,
  '${storeEpoch}',
  'm3-history-fixture-' || printf('%08d', commit_seq),
  '2026-08-10T00:00:00.000Z',
  '{}',
  printf('%064x', commit_seq),
  printf('%064x', commit_seq),
  '{}', '{}', '{}', 1, '{}'
FROM fixture_seq;
COMMIT;
`;
  execFileSync("sqlite3", ["-batch", databasePath, sql], { encoding: "utf8" });
  const [rawFinalCount, rawFinalHead, integrity] = sqliteScalarRow(
    databasePath,
    "SELECT count(*), COALESCE(max(commit_seq), 0), "
      + "(SELECT integrity_check FROM pragma_integrity_check) FROM local_commits;",
  );
  const commitCountAfter = requireSafeInteger(rawFinalCount, "Final history commit count");
  const commitHeadAfter = requireSafeInteger(rawFinalHead, "Final history commit head");
  if (commitCountAfter !== targetCommitCount || integrity !== "ok") {
    throw new Error("Synthetic LocalCommit history failed its integrity check");
  }
  return {
    commitCountBefore,
    commitCountAfter,
    commitHeadAfter,
    storeVersion,
    databaseBytes: fs.statSync(databasePath).size,
  };
}

interface ElectronProcessCpuSample {
  readonly creationTime: number;
  readonly cumulativeSeconds: number;
  readonly percent: number;
  readonly pid: number;
  readonly type: string;
}

const readElectronProcessCpu = async (
  application: ElectronApplication,
): Promise<readonly ElectronProcessCpuSample[]> =>
  await application.evaluate(({ app }) => app.getAppMetrics().map((metric) => ({
    creationTime: metric.creationTime,
    cumulativeSeconds: metric.cpu.cumulativeCPUUsage ?? 0,
    percent: metric.cpu.percentCPUUsage,
    pid: metric.pid,
    type: metric.type,
  })));

const parseProcessCpuTime = (raw: string): number => {
  const fields = raw.trim().split(":").map((field) => Number.parseInt(field, 10));
  if (fields.some((field) => !Number.isSafeInteger(field) || field < 0)) {
    throw new Error("Process CPU time is invalid");
  }
  if (fields.length === 2) return fields[0]! * 60 + fields[1]!;
  if (fields.length === 3) {
    return fields[0]! * 3_600 + fields[1]! * 60 + fields[2]!;
  }
  throw new Error("Process CPU time has an unsupported shape");
};

const readProcessCpuTime = (pid: number): number => parseProcessCpuTime(
  execFileSync("ps", ["-o", "time=", "-p", String(pid)], { encoding: "utf8" }),
);

const readProcessCpuPercent = (pid: number): number => {
  const value = Number.parseFloat(
    execFileSync("ps", ["-o", "%cpu=", "-p", String(pid)], { encoding: "utf8" }).trim(),
  );
  if (Number.isFinite(value) && value >= 0) return value;
  throw new Error("Process CPU percentage is invalid");
};

const cumulativeElectronCpuDelta = (
  before: readonly ElectronProcessCpuSample[],
  after: readonly ElectronProcessCpuSample[],
): number => {
  const beforeByIdentity = new Map(
    before.map((sample) => [`${sample.pid}:${sample.creationTime}`, sample.cumulativeSeconds]),
  );
  return after.reduce((total, sample) => {
    const previous = beforeByIdentity.get(`${sample.pid}:${sample.creationTime}`);
    if (previous === undefined) return total;
    return total + Math.max(0, sample.cumulativeSeconds - previous);
  }, 0);
};

async function readConvergenceDatabase(
  page: Page,
  project: ConvergenceProject,
): Promise<ConvergenceDatabase> {
  const snapshot = requireIpcValue<Record<string, unknown>>(
    await invokeIpc(
      page,
      "database-module:read",
      project.projectId,
      {
        version: DATABASE_MODULE_V2_CONTRACT_VERSION,
        projectId: project.projectId,
        read: {
          target: { kind: "project_default" },
          mode: "database",
        },
      },
    ),
    "Read Project Database",
  );
  const value = snapshot.value;
  if (!isRecord(value) || value.kind !== "database" || !isRecord(value.value)) {
    throw new Error("Project Database read returned an unexpected value");
  }
  if (!Array.isArray(value.value.views)) {
    throw new Error("Project Database read returned no views");
  }
  const view = value.value.views.find(
    (candidate) =>
      isRecord(candidate) && candidate.viewId === project.defaultDatabaseViewId,
  );
  if (!isRecord(view)) {
    throw new Error("Project Database read returned no default view");
  }
  return {
    dataSourceId: requireString(view.dataSourceId, "Project Data Source id"),
    viewId: requireString(view.viewId, "Project Database View id"),
  };
}

async function transferBoardFixturePages(
  page: Page,
  project: ConvergenceProject,
  database: ConvergenceDatabase,
  documentId: string,
  rootBlockIds: readonly string[],
  groupKey: string,
  label: string,
): Promise<readonly string[]> {
  const resultPageIds: string[] = [];
  for (let offset = 0; offset < rootBlockIds.length; offset += 20) {
    const batch = rootBlockIds.slice(offset, offset + 20);
    const result = requireIpcValue<Record<string, unknown>>(
      await invokeIpc(
        page,
        "blocks:transfer",
        project.projectId,
        {
          version: 2,
          operationId: createUuidV7(),
          projectId: project.projectId,
          storeEpoch: project.storeEpoch,
          mode: "move",
          rootBlockIds: batch,
          source: { kind: "document", documentId },
          target: {
            kind: "data_source",
            dataSourceId: database.dataSourceId,
            viewId: database.viewId,
            groupKey,
          },
        },
      ),
      `${label} batch ${Math.floor(offset / 20) + 1}`,
    );
    if (!Array.isArray(result.resultRootBlockIds)) {
      throw new Error(`${label} returned no Page ids`);
    }
    expect(result.resultRootBlockIds).toHaveLength(batch.length);
    resultPageIds.push(...result.resultRootBlockIds.map((value, index) =>
      requireString(value, `${label} Page id ${offset + index}`)
    ));
  }
  return resultPageIds;
}

async function readConvergenceBoardTotal(
  page: Page,
  project: ConvergenceProject,
  minimumCommitSeq?: number,
): Promise<number> {
  const snapshot = requireIpcValue<Record<string, unknown>>(
    await invokeIpc(
      page,
      "database:view-groups:get",
      project.projectId,
      {
        databaseViewId: project.defaultDatabaseViewId,
        ...(minimumCommitSeq === undefined ? {} : { minimumCommitSeq }),
      },
    ),
    "Read Board group totals",
  );
  if (typeof snapshot.totalRows !== "number") {
    throw new Error("Board group totals returned no total row count");
  }
  return snapshot.totalRows;
}

function writeExecutable(filePath: string, source: string): void {
  fs.writeFileSync(filePath, source, { mode: 0o755 });
}

function prepareRuntimeFixture(root: string): void {
  const runtimeRoot = path.join(root, ".generated", "codex-runtime", "agent-runtime");
  fs.mkdirSync(path.join(runtimeRoot, "bin"), { recursive: true });
  fs.mkdirSync(path.join(runtimeRoot, "codex-path"), { recursive: true });
  fs.mkdirSync(path.join(runtimeRoot, "codex-resources"), { recursive: true });
  const artifactBodies = new Map([
    ["bin/interpreter", "#!/bin/sh\nexit 0\n"],
    ["codex-package.json", JSON.stringify({
      entrypoint: "bin/interpreter",
      layoutVersion: 1,
      pathDir: "codex-path",
      resourcesDir: "codex-resources",
      target: `${process.arch}-${process.platform}`,
      variant: "open-interpreter",
      version: "0.0.0-e2e",
    })],
  ]);
  const artifacts = [...artifactBodies].map(([artifactName, body]) => {
    const artifactPath = path.join(runtimeRoot, artifactName);
    if (artifactName === "bin/interpreter") {
      writeExecutable(artifactPath, body);
    } else {
      fs.writeFileSync(artifactPath, body);
    }
    return {
      executable: artifactName === "bin/interpreter",
      path: artifactName,
      sha256: createHash("sha256").update(body).digest("hex"),
      size: Buffer.byteLength(body),
    };
  });
  const runtimeMetadata = {
    artifactRelease: {
      archiveSha256: "0".repeat(64),
      assetName: "nodex-e2e-fixture.tar.gz",
      repository: "junyudev/nodex",
      tag: "agent-runtime-v0.0.0-e2e",
    },
    artifacts,
    codexCompatibilityVersion: "0.0.0-e2e",
    entrypoint: "bin/interpreter",
    layoutVersion: AGENT_RUNTIME_LAYOUT_VERSION,
    packageManifest: {
      entrypoint: "bin/interpreter",
      layoutVersion: 1,
      pathDir: "codex-path",
      resourcesDir: "codex-resources",
      target: `${process.arch}-${process.platform}`,
      variant: "open-interpreter",
      version: "0.0.0-e2e",
    },
    runtimeFamily: "open-interpreter",
    runtimeVersion: "0.0.0-e2e",
    searchPaths: ["codex-path"],
    sourceRevision: {
      commit: "0".repeat(40),
      patches: [],
      repository: "openinterpreter/openinterpreter",
    },
    targetArch: process.arch,
    targetPlatform: process.platform,
    targetTriple: `${process.arch}-${process.platform}`,
  };
  if (!parseBundledAgentRuntimeMetadata(runtimeMetadata)) {
    throw new Error("Electron E2E Agent runtime fixture is invalid");
  }
  fs.writeFileSync(
    path.join(runtimeRoot, "agent-runtime.json"),
    JSON.stringify(runtimeMetadata),
  );
}

async function launchApplication(cwd: string, nodexHome: string): Promise<ElectronApplication> {
  return electron.launch({
    args: [repositoryRoot],
    cwd,
    env: {
      ...process.env,
      NODEX_HOME: nodexHome,
      NODEX_INITIAL_PROJECTS_DIR: path.join(cwd, "workspace"),
      NODE_ENV: "test",
      NODEX_LIBRARY_WORKSPACE_ENABLED: "1",
    },
  });
}

async function launchLargeContentFixtureApplication(): Promise<ElectronApplication> {
  return electron.launch({ args: [largeContentElectronMain] });
}

function forceStopApplicationProcess(
  child: ReturnType<ElectronApplication["process"]>,
): void {
  if (child.pid === undefined) return;

  try {
    if (process.platform === "win32") {
      child.kill("SIGKILL");
      return;
    }
    process.kill(-child.pid, "SIGKILL");
  } catch {
    try {
      child.kill("SIGKILL");
    } catch {
      // The application may have completed its exit concurrently.
    }
  }
}

async function stopApplication(application: ElectronApplication): Promise<void> {
  const child = application.process();
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  const close = application.close().catch(() => undefined);

  try {
    await Promise.race([
      close,
      new Promise<never>((_, reject) => {
        closeTimer = setTimeout(
          () => reject(new Error("Electron close exceeded its teardown deadline")),
          15_000,
        );
      }),
    ]);
  } catch {
    forceStopApplicationProcess(child);
  } finally {
    clearTimeout(closeTimer);
  }
}

async function waitForPathRemoval(filePath: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!fs.existsSync(filePath)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${filePath} to be removed`);
}

async function shutdownTemporaryCore(nodexHome: string): Promise<void> {
  const socketPath = path.join(nodexHome, "run/core/core.sock");
  if (!fs.existsSync(socketPath)) return;

  try {
    const client = await CoreClient.connect({
      nodexHome,
      clientKind: "test",
      buildId: "electron-e2e-teardown",
      requestTimeoutMs: 5_000,
    });
    await client.shutdown();
  } catch (error) {
    await waitForPathRemoval(socketPath, 5_000).catch(() => undefined);
    if (!fs.existsSync(socketPath)) return;
    throw error;
  }

  await waitForPathRemoval(socketPath, 15_000);
}

async function buildLargeContentFixture(outDir: string): Promise<string> {
  await build({
    root: largeContentFixtureRoot,
    base: "./",
    configFile: false,
    logLevel: "warn",
    resolve: rendererViteResolve,
    css: rendererViteCss,
    plugins: createRendererVitePlugins(),
    build: {
      outDir,
      emptyOutDir: true,
    },
  });
  return path.join(outDir, "index.html");
}

async function createFixtureWindow(
  application: ElectronApplication,
  fixtureUrl: string,
): Promise<{ page: Page; windowId: number }> {
  const windowOpened = application.waitForEvent("window");
  const windowId = await application.evaluate(async ({ BrowserWindow }) => {
    const fixtureWindow = new BrowserWindow({
      width: 1_200,
      height: 800,
      show: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    await fixtureWindow.loadURL("about:blank");
    return fixtureWindow.id;
  });
  const page = await windowOpened;
  await page.addInitScript(() => {
    const state = { longTasks: [] as number[] };
    Object.defineProperty(window, "__nodexLargeContentPerformance", {
      configurable: true,
      value: state,
    });
    if (typeof PerformanceObserver === "undefined") return;
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) state.longTasks.push(entry.duration);
    });
    observer.observe({ type: "longtask", buffered: true });
  });
  await page.goto(fixtureUrl);
  await application.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id)?.show(), windowId);
  return { page, windowId };
}

async function closeFixtureWindow(application: ElectronApplication, windowId: number): Promise<void> {
  await application.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id)?.destroy(), windowId);
}

async function waitForLargeContentScenario(page: Page, scenario: LargeContentScenario): Promise<void> {
  await page.locator(`[data-performance-surface="${scenario}"]`).waitFor();
  if (scenario === "license") {
    await page.locator('[aria-label="Open source license text"]').waitFor();
    return;
  }
  if (scenario === "workspace") {
    await page.locator('[aria-label="Source preview for large-source.txt"]').waitFor();
    return;
  }
  if (scenario === "markdown") {
    await page.getByText("Rich preview is unavailable for large Markdown files.").waitFor();
    await page.locator('[aria-label="Markdown source for large-source.md"]').waitFor();
    return;
  }
  if (scenario === "tool") {
    await page.locator('[aria-label="Raw large tool output"]').waitFor();
    return;
  }
  await page.getByText("[earlier output truncated]", { exact: false }).waitFor();
}

async function readTraceStream(session: CDPSession, stream: string): Promise<string> {
  let trace = "";
  let eof = false;
  while (!eof) {
    const chunk = await session.send("IO.read", { handle: stream }) as {
      data?: string;
      eof?: boolean;
    };
    trace += chunk.data ?? "";
    eof = chunk.eof === true;
  }
  await session.send("IO.close", { handle: stream });
  return trace;
}

async function finishTrace(session: CDPSession): Promise<string> {
  const complete = new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for the Chromium trace stream")), 10_000);
    session.once("Tracing.tracingComplete", async (event: { stream?: string }) => {
      clearTimeout(timeout);
      if (!event.stream) {
        reject(new Error("Chromium did not return a trace stream"));
        return;
      }
      try {
        resolve(await readTraceStream(session, event.stream));
      } catch (error) {
        reject(error);
      }
    });
  });
  await session.send("Tracing.end");
  return await complete;
}

function maxTraceRunTaskMs(trace: string): number {
  const parsed = JSON.parse(trace) as {
    traceEvents?: Array<{ name?: string; dur?: number }>;
  };
  let maximum = 0;
  for (const event of parsed.traceEvents ?? []) {
    if (event.name !== "RunTask" || typeof event.dur !== "number") continue;
    maximum = Math.max(maximum, event.dur / 1_000);
  }
  return maximum;
}

async function sampleLargeContentScenario(input: {
  application: ElectronApplication;
  artifactDir: string;
  fixtureFile: string;
  scenario: LargeContentScenario;
}): Promise<LargeContentScenarioMetrics> {
  const fixtureUrl = new URL(pathToFileURL(input.fixtureFile));
  fixtureUrl.searchParams.set("scenario", input.scenario);
  const { page, windowId } = await createFixtureWindow(input.application, fixtureUrl.href);
  try {
    await page.locator('[aria-label="Warm viewport reader"]').waitFor();

    // Warm the exact component tree and all lazy chunks once, then remount from a
    // clean surface so the sample measures steady-state user-visible work.
    await page.locator(`[data-run-scenario="${input.scenario}"]`).click();
    await waitForLargeContentScenario(page, input.scenario);
    await page.locator("[data-reset-scenario]").evaluate((element: HTMLButtonElement) => element.click());
    await page.locator('[aria-label="Warm viewport reader"]').waitFor();

    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Tracing.start", {
      categories: [
        "devtools.timeline",
        "disabled-by-default-devtools.timeline",
        "blink.user_timing",
      ].join(","),
      transferMode: "ReturnAsStream",
    });
    await page.evaluate(() => {
      const state = (window as unknown as {
        __nodexLargeContentPerformance: { longTasks: number[] };
      }).__nodexLargeContentPerformance;
      state.longTasks.length = 0;
    });

    await page.locator(`[data-run-scenario="${input.scenario}"]`).click();
    await waitForLargeContentScenario(page, input.scenario);
    await page.waitForTimeout(300);

    const rendererMetrics = await page.evaluate(() => {
      const state = (window as unknown as {
        __nodexLargeContentPerformance: { longTasks: number[] };
      }).__nodexLargeContentPerformance;
      return {
        domNodes: document.getElementsByTagName("*").length,
        maxLongTaskMs: Math.max(0, ...state.longTasks),
      };
    });
    const trace = await finishTrace(cdp);
    await cdp.send("Accessibility.enable");
    const accessibilityTree = await cdp.send("Accessibility.getFullAXTree") as {
      nodes?: unknown[];
    };
    await cdp.send("Accessibility.disable");

    const traceFileName = `${input.scenario}-trace.json`;
    const tracePath = path.join(input.artifactDir, traceFileName);
    fs.writeFileSync(tracePath, trace);
    const traceBytes = Buffer.byteLength(trace);
    const traceSha256 = createHash("sha256").update(trace).digest("hex");
    return {
      scenario: input.scenario,
      ...rendererMetrics,
      traceMaxRunTaskMs: maxTraceRunTaskMs(trace),
      accessibilityNodes: accessibilityTree.nodes?.length ?? 0,
      tracePath,
      traceBytes,
      traceSha256,
    };
  } finally {
    await closeFixtureWindow(input.application, windowId);
  }
}

test("provisions and persists the initial source-backed Project across a full Electron restart", async () => {
  test.setTimeout(120_000);
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-electron-e2e-"));
  const nodexHome = path.join(fixtureRoot, "profile");
  const projectsDirectory = path.join(fixtureRoot, "workspace");
  fs.mkdirSync(projectsDirectory, { recursive: true });
  prepareRuntimeFixture(fixtureRoot);

  let application: ElectronApplication | undefined;
  try {
    application = await launchApplication(fixtureRoot, nodexHome);
    const firstWindow = await application.firstWindow();
    await firstWindow.evaluate(() => window.api?.awaitInitialization?.());

    await expect.poll(async () => {
      return await firstWindow.evaluate(async () => {
        const projects = await window.api?.invoke("projects:list") as {
          items?: unknown[];
        } | undefined;
        return projects?.items?.length ?? 0;
      });
    }).toBe(1);
    await expect(firstWindow.getByRole("heading", {
      name: "Select a project",
    })).toHaveCount(0);

    const firstState = await firstWindow.evaluate(async () => {
      const projects = await window.api?.invoke("projects:list") as {
        items?: Array<{
          id: string;
          name: string;
          primaryWorkspaceRoot: string | null;
        }>;
      } | undefined;
      const bootstrap = await window.api?.invoke("window-sessions:bootstrap") as {
        session?: {
          layout?: {
            location?: {
              kind?: string;
              projectId?: string;
            };
            scenesByOwnerKey?: Record<string, {
              primary?: {
                kind?: string;
              };
              panelSurfacesById?: Record<string, {
                kind?: string;
                config?: { pageId?: string };
              }>;
              panels?: {
                right?: {
                  collapsed?: boolean;
                  size?: { fullWidth?: boolean };
                  layout?: {
                    root?: { activeTabId?: string | null };
                  };
                };
              };
            }>;
          };
        };
      } | undefined;
      return { projects, bootstrap };
    });
    const createdProject = firstState.projects?.items?.[0];
    expect(createdProject).toMatchObject({ name: "My Project" });
    expect(createdProject?.primaryWorkspaceRoot).toBe(
      path.join(projectsDirectory, "My Project"),
    );
    expect(fs.realpathSync(createdProject?.primaryWorkspaceRoot ?? "")).toBe(
      fs.realpathSync(path.join(projectsDirectory, "My Project")),
    );

    const layout = firstState.bootstrap?.session?.layout;
    expect(layout?.location).toMatchObject({
      kind: "project",
      projectId: createdProject?.id,
    });
    const projectScene = createdProject?.id
      ? layout?.scenesByOwnerKey?.[`project:${createdProject.id}`]
      : undefined;
    expect(projectScene?.primary?.kind).toBe("db_view");
    const surfaces = Object.values(projectScene?.panelSurfacesById ?? {});
    expect(surfaces.map((surface) => surface.kind)).toEqual(["page_stage"]);
    expect(projectScene?.panels?.right).toMatchObject({
      collapsed: false,
      size: { fullWidth: true },
    });
    const activeRightTabId = projectScene?.panels?.right?.layout?.root
      ?.activeTabId;
    expect(
      activeRightTabId
        ? projectScene?.panelSurfacesById?.[activeRightTabId]?.kind
        : undefined,
    ).toBe("page_stage");
    const starterPageId = surfaces.find((surface) => surface.kind === "page_stage")
      ?.config?.pageId;
    expect(starterPageId).toBeTruthy();

    const pageDetail = await firstWindow.evaluate(async ({ projectId, pageId }) => {
      return await window.api?.invoke("pages:detail:get", projectId, pageId);
    }, {
      projectId: createdProject?.id ?? "",
      pageId: starterPageId ?? "",
    });
    expect(pageDetail).toMatchObject({
      ok: true,
      value: {
        page: {
          title: "Welcome to Nodex",
        },
        document: {
          readiness: "ready",
        },
      },
    });
    expect((pageDetail as {
      value?: { page?: { plainText?: string } };
    }).value?.page?.plainText).toContain("Connect your model");
    expect((pageDetail as {
      value?: { page?: { plainText?: string } };
    }).value?.page?.plainText).toContain(
      createdProject?.primaryWorkspaceRoot,
    );

    expect(fs.existsSync(path.join(
      nodexHome,
      "recovery",
      "initial-project-v2.json",
    ))).toBe(false);
    expect(fs.existsSync(path.join(
      createdProject?.primaryWorkspaceRoot ?? "",
      ".nodex-initial-project-v2.json",
    ))).toBe(false);

    await stopApplication(application);
    application = undefined;
    application = await launchApplication(fixtureRoot, nodexHome);
    const restartedWindow = await application.firstWindow();
    await restartedWindow.evaluate(() => window.api?.awaitInitialization?.());

    const persisted = await restartedWindow.evaluate(async () => {
      const projects = await window.api?.invoke("projects:list");
      const bootstrap = await window.api?.invoke("window-sessions:bootstrap");
      return { projects, bootstrap };
    });
    expect((persisted as {
      projects?: { items?: unknown[] };
    }).projects?.items).toEqual([
      expect.objectContaining({
        id: createdProject?.id,
        name: "My Project",
        primaryWorkspaceRoot: createdProject?.primaryWorkspaceRoot,
      }),
    ]);
    expect((persisted as {
      bootstrap?: { session?: { layout?: { location?: unknown } } };
    }).bootstrap?.session?.layout?.location).toMatchObject({
      kind: "project",
      projectId: createdProject?.id,
    });
    await expect(restartedWindow.getByRole("heading", {
      name: "Select a project",
    })).toHaveCount(0);
  } finally {
    if (application) await stopApplication(application);
    await shutdownTemporaryCore(nodexHome);
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("creates and draws in an inline Canvas without taking over the Page", async () => {
  test.setTimeout(120_000);
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-canvas-e2e-"));
  const nodexHome = path.join(fixtureRoot, "profile");
  const workspace = path.join(fixtureRoot, "workspace");
  fs.mkdirSync(workspace, { recursive: true });
  prepareRuntimeFixture(fixtureRoot);

  let application: ElectronApplication | undefined;
  try {
    application = await launchApplication(fixtureRoot, nodexHome);
    const page = await application.firstWindow();
    await page.evaluate(() => window.api?.awaitInitialization?.());
    await page.evaluate(
      async ({ name, source }) =>
        window.api?.invoke("projects:create", { name, sources: [source] }),
      { name: "Canvas workflow", source: workspace },
    );

    await page.getByRole("button", {
      name: "Open Canvas workflow",
      exact: true,
    }).click();
    await page.getByRole("tab", { name: "Project Home" }).waitFor();
    await page.getByRole("button", { name: "New Page or Database" }).click({
      force: true,
    });
    await page.getByRole("menuitem", { name: "Page" }).click();
    await page.getByRole("button", { name: "Page actions" }).waitFor();

    await page
      .getByRole("button", { name: "Actions for Untitled" })
      .last()
      .click();
    await page.getByRole("menuitem", { name: "Open in Project…" }).click();
    await page.getByRole("button", { name: "Grant and open" }).click();

    const editor = page
      .locator('[data-page-stage-surface="true"]')
      .getByTestId("page-stage-scroll-container")
      .locator(".nfm-editor .ProseMirror[contenteditable=true]")
      .first();
    await editor.click();
    await page.keyboard.type("/canvas");
    await page.evaluate(() => {
      const state = window as typeof window & {
        __canvasPendingObserved?: boolean;
      };
      state.__canvasPendingObserved = false;
      const observer = new MutationObserver(() => {
        if (!document.querySelector("[data-canvas-create-pending]")) return;
        state.__canvasPendingObserved = true;
        observer.disconnect();
      });
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
      });
    });
    await page.getByRole("option", { name: /Canvas/ }).click();
    await expect.poll(
      () => page.evaluate(() =>
        (window as typeof window & {
          __canvasPendingObserved?: boolean;
        }).__canvasPendingObserved === true
      ),
    ).toBe(true);
    const canvasBlock = page.locator("[data-canvas-block]").first();
    await expect(canvasBlock).toBeVisible({ timeout: 5_000 });
    await expect(canvasBlock).toHaveAttribute(
      "data-canvas-block-active",
      "true",
      { timeout: 15_000 },
    );
    await expect(
      canvasBlock.locator("[data-canvas-create-pending]"),
    ).toHaveCount(0);
    const boundary = canvasBlock.locator(
      '[data-excalidraw-embed-boundary="inline"]',
    );
    await expect(boundary.locator(".excalidraw")).toBeVisible();

    const pageActions = page.getByRole("button", { name: "Page actions" });
    const actionsBox = await pageActions.boundingBox();
    if (!actionsBox) throw new Error("Page actions have no layout box");
    const pageActionsHitBoundary = await page.evaluate(({ x, y }) => {
      const hit = document.elementFromPoint(x, y);
      return hit
        ?.closest("[data-excalidraw-embed-boundary]")
        ?.getAttribute("data-excalidraw-embed-boundary") ?? null;
    }, {
      x: actionsBox.x + actionsBox.width / 2,
      y: actionsBox.y + actionsBox.height / 2,
    });
    expect(pageActionsHitBoundary).toBeNull();
    await pageActions.click();
    await page.keyboard.press("Escape");

    const canvasId = await canvasBlock.getAttribute("data-canvas-block");
    if (!canvasId) throw new Error("Canvas block has no owner identity");
    const readCanvasHead = async (): Promise<number> =>
      await page.evaluate(async ({ targetCanvasId, contractVersion }) => {
        const raw = await window.api?.invoke(
          "library-module:read",
          { kind: "library" },
          {
            version: contractVersion,
            read: { mode: "canvas_target", canvasId: targetCanvasId },
          },
        ) as {
          ok?: boolean;
          value?: {
            value?: {
              kind?: string;
              value?: {
                status?: string;
                summary?: { documentHeadSeq?: number };
              };
            };
          };
        } | undefined;
        const target = raw?.value?.value;
        if (
          !raw?.ok
          || target?.kind !== "canvas_target"
          || target.value?.status !== "available"
        ) {
          return -1;
        }
        return target.value.summary?.documentHeadSeq ?? -1;
      }, {
        targetCanvasId: canvasId,
        contractVersion: LIBRARY_MODULE_CONTRACT_VERSION,
      });
    const initialHead = await readCanvasHead();

    const rectangleTool = boundary.getByRole("radio", { name: /Rectangle/ });
    await rectangleTool.check({ force: true });
    const interactiveCanvas = boundary.locator(
      "canvas.excalidraw__canvas.interactive",
    );
    const canvasBox = await interactiveCanvas.boundingBox();
    if (!canvasBox) throw new Error("Interactive Canvas has no layout box");
    await page.mouse.move(
      canvasBox.x + canvasBox.width * 0.35,
      canvasBox.y + canvasBox.height * 0.55,
    );
    await page.mouse.down();
    await page.mouse.move(
      canvasBox.x + canvasBox.width * 0.55,
      canvasBox.y + canvasBox.height * 0.72,
      { steps: 5 },
    );
    await page.mouse.up();

    await expect.poll(readCanvasHead, { timeout: 10_000 }).toBeGreaterThan(
      initialHead,
    );
  } finally {
    if (application) await stopApplication(application);
    await shutdownTemporaryCore(nodexHome);
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("converges a Move to operation in the live standalone Pages projection", async () => {
  test.setTimeout(120_000);
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nx-move-"));
  const nodexHome = path.join(fixtureRoot, "profile");
  const workspace = path.join(fixtureRoot, "workspace");
  fs.mkdirSync(workspace, { recursive: true });
  prepareRuntimeFixture(fixtureRoot);

  let application: ElectronApplication | undefined;
  try {
    application = await launchApplication(fixtureRoot, nodexHome);
    const page = await application.firstWindow();
    await page.evaluate(() => window.api?.awaitInitialization?.());

    const project = await createConvergenceProject(
      page,
      "Move convergence",
      workspace,
    );
    const source = await createConvergencePage(page, project, "Source Page");
    const target = await createConvergencePage(page, project, "Target Page");

    await page.getByRole("button", {
      name: "Open Move convergence",
      exact: true,
    }).click();
    await page.getByRole("tab", { name: "Project Home" }).waitFor();
    await page.getByRole("button", {
      name: "Actions for Source Page",
      exact: true,
    }).click();
    await page.getByRole("menuitem", { name: "Move to…", exact: true }).click();

    const dialog = page.getByRole("dialog");
    await dialog.waitFor();
    await dialog.getByRole("combobox").selectOption({
      label: "Target Page — Library",
    });
    await dialog.getByRole("button", { name: "Move", exact: true }).click();
    await dialog.waitFor({ state: "detached" });

    // The source must disappear from the mounted sidebar without reopening the
    // Project or manually refreshing the Library.
    await expect.poll(
      async () =>
        await page.getByRole("button", {
          name: "Actions for Source Page",
          exact: true,
        }).count(),
      { timeout: 5_000 },
    ).toBe(0);
    await expect(page.getByRole("button", {
      name: "Actions for Target Page",
      exact: true,
    })).toBeVisible();

    const pathSnapshot = requireIpcValue<Record<string, unknown>>(
      await invokeIpc(
        page,
        "library-module:read",
        { kind: "library" },
        {
          version: LIBRARY_MODULE_CONTRACT_VERSION,
          read: { mode: "path", target: { kind: "page", pageId: source.pageId } },
        },
      ),
      "Read moved Page path",
    );
    const pathValue = pathSnapshot.value;
    if (!isRecord(pathValue) || pathValue.kind !== "path" || !Array.isArray(pathValue.nodes)) {
      throw new Error("Moved Page path read returned an unexpected value");
    }
    expect(pathValue.nodes.map((node) => isRecord(node) ? node.pageId : undefined)).toEqual([
      target.pageId,
      source.pageId,
    ]);
  } finally {
    if (application) await stopApplication(application);
    await shutdownTemporaryCore(nodexHome);
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("creates one stable Board Page through the app modal @create-modal-smoke", async () => {
  test.setTimeout(120_000);
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nx-create-modal-"));
  const nodexHome = path.join(fixtureRoot, "profile");
  const workspace = path.join(fixtureRoot, "workspace");
  fs.mkdirSync(workspace, { recursive: true });
  prepareRuntimeFixture(fixtureRoot);

  let application: ElectronApplication | undefined;
  try {
    application = await launchApplication(fixtureRoot, nodexHome);
    const page = await application.firstWindow();
    await page.evaluate(() => window.api?.awaitInitialization?.());

    const project = await createConvergenceProject(
      page,
      "Create modal convergence",
      workspace,
    );
    await page.getByRole("button", {
      name: "Open Create modal convergence",
      exact: true,
    }).click();
    await page.getByRole("tab", { name: "Project Home" }).waitFor();
    const triageColumn = page.locator(
      '[data-board-column-root][data-board-column-id="triage"]',
    );
    await expect(triageColumn).toBeVisible({ timeout: 15_000 });

    const createButton = triageColumn.locator(
      '[data-page-create-trigger="auto-collapsed-column"]',
    );
    await expect(createButton).toHaveAttribute("aria-disabled", "false", {
      timeout: 15_000,
    });
    await createButton.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Page title").fill("Modal-created Page");

    await page.evaluate(() => {
      const state = window as typeof window & {
        __createModalFrameCounts?: number[];
        __createModalFrameObserverActive?: boolean;
      };
      state.__createModalFrameCounts = [];
      state.__createModalFrameObserverActive = true;
      const sample = () => {
        if (!state.__createModalFrameObserverActive) return;
        const count = [...document.querySelectorAll(
          '[data-board-column-root][data-board-column-id="triage"] [data-board-uuid-v7]',
        )].filter((card) => card.textContent?.includes("Modal-created Page")).length;
        if (count > 0 || state.__createModalFrameCounts?.length) {
          state.__createModalFrameCounts?.push(count);
        }
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });

    await dialog.getByRole("button", { name: "Create page", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    const createdCard = triageColumn.locator("[data-board-uuid-v7]").filter({
      hasText: "Modal-created Page",
    });
    await expect(createdCard).toHaveCount(1, { timeout: 15_000 });
    await expect.poll(
      async () => await readConvergenceBoardTotal(page, project),
      { timeout: 15_000 },
    ).toBe(1);
    await page.evaluate(async () => {
      await new Promise<void>((resolve) => {
        let remaining = 8;
        const next = () => {
          remaining -= 1;
          if (remaining === 0) {
            resolve();
            return;
          }
          requestAnimationFrame(next);
        };
        requestAnimationFrame(next);
      });
      (window as typeof window & {
        __createModalFrameObserverActive?: boolean;
      }).__createModalFrameObserverActive = false;
    });
    const frameCounts = await page.evaluate(() =>
      (window as typeof window & {
        __createModalFrameCounts?: number[];
      }).__createModalFrameCounts ?? []
    );
    expect(frameCounts.length).toBeGreaterThan(0);
    expect(new Set(frameCounts)).toEqual(new Set([1]));
    await expect(createdCard).toHaveCount(1);
  } finally {
    if (application) await stopApplication(application);
    await shutdownTemporaryCore(nodexHome);
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("converges a Block transfer into the live Board Page projection", async () => {
  test.setTimeout(120_000);
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nx-board-"));
  const nodexHome = path.join(fixtureRoot, "profile");
  const workspace = path.join(fixtureRoot, "workspace");
  fs.mkdirSync(workspace, { recursive: true });
  prepareRuntimeFixture(fixtureRoot);

  let application: ElectronApplication | undefined;
  try {
    application = await launchApplication(fixtureRoot, nodexHome);
    const page = await application.firstWindow();
    await page.evaluate(() => window.api?.awaitInitialization?.());

    const project = await createConvergenceProject(
      page,
      "Board convergence",
      workspace,
    );
    const source = await createConvergencePage(page, project, "Source Page");
    const seeded = await seedConvergenceDocument(page, project, source);
    const database = await readConvergenceDatabase(page, project);

    await page.getByRole("button", {
      name: "Open Board convergence",
      exact: true,
    }).click();
    await page.getByRole("tab", { name: "Project Home" }).waitFor();
    await expect(page.locator(
      '[data-board-column-root][data-board-column-id="triage"]',
    )).toBeVisible({
      timeout: 10_000,
    });

    const receipt = requireIpcValue<Record<string, unknown>>(
      await invokeIpc(
        page,
        "blocks:transfer",
        project.projectId,
        {
          version: 2,
          operationId: createUuidV7(),
          projectId: project.projectId,
          storeEpoch: project.storeEpoch,
          mode: "move",
          rootBlockIds: [seeded.blockIds[1]],
          source: { kind: "document", documentId: seeded.documentId },
          target: {
            kind: "data_source",
            dataSourceId: database.dataSourceId,
            viewId: database.viewId,
            groupKey: "triage",
          },
        },
      ),
      "Transfer Block into Board",
    );
    if (!Array.isArray(receipt.resultRootBlockIds)) {
      throw new Error("Block transfer returned no result Page id");
    }
    const resultPageId = requireString(
      receipt.resultRootBlockIds[0],
      "Transferred Page id",
    );
    const commitSeq = receipt.commitSeq;
    if (typeof commitSeq !== "number") {
      throw new Error("Block transfer returned no change-log sequence");
    }
    const evidence = receipt.transformationEvidence;
    expect(evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "promote",
        sourceBlockId: seeded.blockIds[1],
        resultPageId,
      }),
    ]));

    const detail = requireIpcValue<Record<string, unknown>>(
      await invokeIpc(
        page,
        "pages:detail:get",
        project.projectId,
        resultPageId,
        commitSeq,
      ),
      "Read transferred Page detail",
    );
    expect(detail.page).toMatchObject({
      title: "Dragged source",
      parent: {
        kind: "data_source",
        dataSourceId: database.dataSourceId,
      },
    });

    const card = page.locator(`[data-board-uuid-v7="${resultPageId}"]`);
    await expect(card).toBeVisible({ timeout: 5_000 });
    await expect(card).toContainText("Dragged source");
  } finally {
    if (application) await stopApplication(application);
    await shutdownTemporaryCore(nodexHome);
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("keeps the Page editor mounted while its Document commits", async () => {
  test.setTimeout(120_000);
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nx-page-edit-"));
  const nodexHome = path.join(fixtureRoot, "profile");
  const workspace = path.join(fixtureRoot, "workspace");
  fs.mkdirSync(workspace, { recursive: true });
  prepareRuntimeFixture(fixtureRoot);

  let application: ElectronApplication | undefined;
  try {
    application = await launchApplication(fixtureRoot, nodexHome);
    const page = await application.firstWindow();
    await page.evaluate(() => window.api?.awaitInitialization?.());
    const project = await createConvergenceProject(
      page,
      "Page edit stability",
      workspace,
    );
    const fixturePage = await createConvergenceBoardPage(
      page,
      project,
      "Stable editor Page",
      "Existing body",
    );

    await page.getByRole("button", {
      name: "Open Page edit stability",
      exact: true,
    }).click();
    await page.getByRole("tab", { name: "Project Home" }).waitFor();
    const card = page.locator(
      `[data-board-uuid-v7="${fixturePage.pageId}"]`,
    );
    await expect(card).toBeVisible({ timeout: 15_000 });
    await card.click();
    await page.getByRole("tab", { name: "Stable editor Page" }).waitFor();

    const surface = page.locator('[data-page-stage-surface="true"]:visible');
    const editor = surface.locator(
      '.nfm-editor .ProseMirror[contenteditable="true"]',
    );
    await expect(editor).toBeVisible({ timeout: 15_000 });
    const detailBefore = requireIpcValue<Record<string, unknown>>(
      await invokeIpc(
        page,
        "pages:detail:get",
        project.projectId,
        fixturePage.pageId,
      ),
      "Read Page detail before editing",
    );
    const commitSeqBefore = detailBefore.commitSeq;
    if (typeof commitSeqBefore !== "number") {
      throw new Error("Page detail has no commit sequence before editing");
    }

    await page.evaluate(() => {
      const target = globalThis as typeof globalThis & {
        __nodexPageEditStability?: {
          readonly observer: MutationObserver;
          editorRemovals: number;
          skeletonAdds: number;
          titleRemovals: number;
        };
      };
      const measurement = {
        editorRemovals: 0,
        skeletonAdds: 0,
        titleRemovals: 0,
        observer: null as unknown as MutationObserver,
      };
      const contains = (node: Node, selector: string): boolean =>
        node instanceof Element
        && (node.matches(selector) || node.querySelector(selector) !== null);
      measurement.observer = new MutationObserver((records) => {
        for (const record of records) {
          for (const node of record.removedNodes) {
            if (contains(node, '[aria-label="Page title"]')) {
              measurement.titleRemovals += 1;
            }
            if (contains(node, '.nfm-editor .ProseMirror[contenteditable="true"]')) {
              measurement.editorRemovals += 1;
            }
          }
          for (const node of record.addedNodes) {
            if (contains(node, '[role="status"][aria-busy="true"]')) {
              measurement.skeletonAdds += 1;
            }
          }
        }
      });
      measurement.observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
      });
      target.__nodexPageEditStability = measurement;
    });

    await editor.click();
    await page.keyboard.press("End");
    await page.keyboard.type("x");
    await expect.poll(async () => {
      const detail = requireIpcValue<Record<string, unknown>>(
        await invokeIpc(
          page,
          "pages:detail:get",
          project.projectId,
          fixturePage.pageId,
        ),
        "Read Page detail after editing",
      );
      return detail.commitSeq;
    }, { timeout: 15_000 }).toBeGreaterThan(commitSeqBefore);
    await page.waitForTimeout(100);

    const measurement = await page.evaluate(() => {
      const target = globalThis as typeof globalThis & {
        __nodexPageEditStability?: {
          readonly observer: MutationObserver;
          editorRemovals: number;
          skeletonAdds: number;
          titleRemovals: number;
        };
      };
      const current = target.__nodexPageEditStability;
      if (!current) throw new Error("Page edit stability measurement is missing");
      current.observer.disconnect();
      return {
        editorRemovals: current.editorRemovals,
        skeletonAdds: current.skeletonAdds,
        titleRemovals: current.titleRemovals,
      };
    });
    expect(measurement).toEqual({
      editorRemovals: 0,
      skeletonAdds: 0,
      titleRemovals: 0,
    });
    await expect(editor).toBeVisible();
  } finally {
    if (application) await stopApplication(application);
    await shutdownTemporaryCore(nodexHome);
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

// This is the native source-gesture smoke. High-pressure tests below remain on
// the direct typed transfer boundary because they test transaction convergence,
// not the handle-to-dragover pipeline exercised here.
test("moves a Block into a Board with native DnD @dnd-smoke", async () => {
  test.setTimeout(120_000);
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nx-dnd-smoke-"));
  const nodexHome = path.join(fixtureRoot, "profile");
  const workspace = path.join(fixtureRoot, "workspace");
  fs.mkdirSync(workspace, { recursive: true });
  prepareRuntimeFixture(fixtureRoot);

  let application: ElectronApplication | undefined;
  try {
    application = await launchApplication(fixtureRoot, nodexHome);
    const page = await application.firstWindow();
    await page.evaluate(() => window.api?.awaitInitialization?.());

    const project = await createConvergenceProject(
      page,
      "Native DnD smoke",
      workspace,
    );
    const database = await readConvergenceDatabase(page, project);
    await createConvergenceBoardPage(
      page,
      project,
      "Board fixture one",
      "First existing Board Page",
    );
    await createConvergenceBoardPage(
      page,
      project,
      "Board fixture two",
      "Second existing Board Page",
    );
    const source = await createConvergenceBoardPage(
      page,
      project,
      "DnD source Page",
      "Page containing the native DnD fixture",
    );
    await seedConvergenceDocument(
      page,
      project,
      source,
      [
        "Before smoke sibling",
        "DnD smoke title",
        "\tDnD smoke first child",
        "\tDnD smoke middle child",
        "\tDnD smoke last child",
        "After smoke sibling",
      ].join("\n"),
    );

    await page.getByRole("button", {
      name: "Open Native DnD smoke",
      exact: true,
    }).click();
    await page.getByRole("tab", { name: "Project Home" }).waitFor();
    const triageColumn = page.locator(
      '[data-board-column-root][data-board-column-id="triage"]',
    );
    await expect(triageColumn).toBeVisible({ timeout: 15_000 });
    await expect(triageColumn.locator("[data-board-uuid-v7]")).toHaveCount(3, {
      timeout: 15_000,
    });

    const sourceCard = triageColumn.locator(
      `[data-board-uuid-v7="${source.pageId}"]`,
    );
    await expect(sourceCard).toBeVisible();
    // Opening the fixture Page is setup for the gesture under test. Dispatch
    // the card click directly so its delayed hover tooltip cannot race and
    // intercept Playwright's pointer action during repeat runs.
    await sourceCard.locator('[data-card-context-menu-trigger="true"]')
      .evaluate((element) => (element as HTMLElement).click());
    await page.getByRole("tab", { name: "DnD source Page" }).waitFor();
    await expect(triageColumn).toBeVisible({ timeout: 15_000 });

    const sourcePanel = page.getByRole("tabpanel", {
      name: /DnD source Page$/,
    });
    await expect(sourcePanel).toBeVisible();
    const sourceEditor = sourcePanel.locator(".nfm-editor");
    const sourceSurface = sourceEditor.locator(
      '.ProseMirror[contenteditable="true"]',
    );
    await expect(sourceSurface).toBeVisible({ timeout: 15_000 });
    const sourceBlock = sourceSurface.locator(".bn-block[data-id]").filter({
      hasText: "DnD smoke title",
    }).first();
    await expect(sourceBlock).toBeVisible();

    await dragBlockToBoardWithMouse({
      page,
      sourceBlock,
      sourceEditor,
      targetColumn: triageColumn,
    });

    await expect(triageColumn.locator("[data-board-uuid-v7]")).toHaveCount(4, {
      timeout: 15_000,
    });
    await expect.poll(
      async () => await readConvergenceBoardTotal(page, project),
      { timeout: 15_000 },
    ).toBe(4);
    const promotedCards = triageColumn.locator(
      `[data-board-uuid-v7]:not([data-board-uuid-v7="${source.pageId}"])`,
    ).filter({ hasText: "DnD smoke title" });
    await expect(promotedCards).toHaveCount(1, { timeout: 15_000 });
    await expect(promotedCards).toBeVisible();
    await expect(sourceBlock).toHaveCount(0, { timeout: 15_000 });
    await expect(sourceSurface.locator(".bn-block[data-id]").filter({
      hasText: "Before smoke sibling",
    })).toHaveCount(1);
    await expect(sourceSurface.locator(".bn-block[data-id]").filter({
      hasText: "After smoke sibling",
    })).toHaveCount(1);

    const promotedPageId = requireString(
      await promotedCards.getAttribute("data-board-uuid-v7"),
      "Native DnD promoted Page id",
    );
    const detail = requireIpcValue<Record<string, unknown>>(
      await invokeIpc(
        page,
        "pages:detail:get",
        project.projectId,
        promotedPageId,
      ),
      "Read native DnD promoted Page detail",
    );
    expect(detail.page).toMatchObject({
      title: "DnD smoke title",
      parent: {
        kind: "data_source",
        dataSourceId: database.dataSourceId,
      },
      plainText: expect.stringContaining("DnD smoke first child"),
    });
    expect(detail.page).toMatchObject({
      plainText: expect.stringContaining("DnD smoke last child"),
    });
    await expect(page.locator('[data-slot="toast-item"] [role="alert"]'))
      .toHaveCount(0);
  } finally {
    if (application) await stopApplication(application);
    await shutdownTemporaryCore(nodexHome);
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("reorders the Core-backed List with native DnD @list-dnd-smoke", async () => {
  test.setTimeout(120_000);
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nx-list-dnd-smoke-"));
  const nodexHome = path.join(fixtureRoot, "profile");
  const workspace = path.join(fixtureRoot, "workspace");
  fs.mkdirSync(workspace, { recursive: true });
  prepareRuntimeFixture(fixtureRoot);

  let application: ElectronApplication | undefined;
  try {
    application = await launchApplication(fixtureRoot, nodexHome);
    const page = await application.firstWindow();
    await page.evaluate(() => window.api?.awaitInitialization?.());

    const project = await createConvergenceProject(
      page,
      "Native List DnD smoke",
      workspace,
    );
    const firstFixture = await createConvergenceBoardPage(
      page,
      project,
      "List fixture one",
      "First List Page",
    );
    const secondFixture = await createConvergenceBoardPage(
      page,
      project,
      "List fixture two",
      "Second List Page",
    );
    const thirdFixture = await createConvergenceBoardPage(
      page,
      project,
      "List fixture three",
      "Third List Page",
    );

    await page.getByRole("button", {
      name: "Open Native List DnD smoke",
      exact: true,
    }).click();
    const board = page.locator("[data-board-root]");
    await expect(board).toBeVisible({ timeout: 15_000 });
    await page.getByRole("tablist", { name: "Database views" })
      .getByRole("tab", { name: "List", exact: true })
      .click();

    const grid = page.getByRole("grid", { name: /List$/ });
    await expect(grid).toBeVisible({ timeout: 15_000 });
    const rows = grid.locator(
      '[data-list-row="true"][data-database-view-page-id]',
    );
    for (const fixture of [firstFixture, secondFixture, thirdFixture]) {
      await expect(grid.locator(
        `[data-list-row="true"][data-database-view-page-id="${fixture.pageId}"]`,
      )).toHaveCount(1, { timeout: 15_000 });
    }
    const initialOrder = await rows.evaluateAll((elements) => elements.map((element) =>
      element.getAttribute("data-database-view-page-id") ?? ""
    ));
    expect(initialOrder).toEqual(expect.arrayContaining([
      firstFixture.pageId,
      secondFixture.pageId,
      thirdFixture.pageId,
    ]));
    const targetPageId = firstFixture.pageId;
    const sourcePageId = thirdFixture.pageId;
    const sourceRow = grid.locator(
      `[data-list-row="true"][data-database-view-page-id="${sourcePageId}"]`,
    );
    const targetRow = grid.locator(
      `[data-list-row="true"][data-database-view-page-id="${targetPageId}"]`,
    );

    await dragListRowWithMouse({
      page,
      sourceRow,
      targetRow,
      position: "before",
    });

    await expect.poll(async () => await rows.evaluateAll((elements) => elements.map((element) =>
      element.getAttribute("data-database-view-page-id") ?? ""
    )), { timeout: 15_000 }).toEqual([
      sourcePageId,
      ...initialOrder.filter((pageId) => pageId !== sourcePageId),
    ]);
    await expect.poll(async () => {
      const result = requireIpcValue<{
        readonly rows: readonly {
          readonly kind: string;
          readonly row?: { readonly page?: { readonly pageId?: string } };
        }[];
      }>(await invokeIpc(
        page,
        "database:list-window:get",
        project.projectId,
        { databaseViewId: project.defaultDatabaseViewId, first: 50 },
      ), "Read reordered List window");
      return result.rows.flatMap((row) =>
        row.kind === "page" && row.row?.page?.pageId ? [row.row.page.pageId] : []
      );
    }, { timeout: 15_000 }).toEqual([
      sourcePageId,
      ...initialOrder.filter((pageId) => pageId !== sourcePageId),
    ]);
  } finally {
    if (application) await stopApplication(application);
    await shutdownTemporaryCore(nodexHome);
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("keeps Page ready and idle CPU bounded with 14k LocalCommit history", async ({}, testInfo) => {
  test.setTimeout(360_000);
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nx-pr-"));
  const nodexHome = path.join(fixtureRoot, "profile");
  const workspace = path.join(fixtureRoot, "workspace");
  fs.mkdirSync(workspace, { recursive: true });
  prepareRuntimeFixture(fixtureRoot);

  let application: ElectronApplication | undefined;
  try {
    application = await launchApplication(fixtureRoot, nodexHome);
    const setupPage = await application.firstWindow();
    await setupPage.evaluate(() => window.api?.awaitInitialization?.());
    const project = await createConvergenceProject(
      setupPage,
      "Large history Page ready",
      workspace,
    );
    const fixturePages: Array<ConvergencePage & { readonly title: string }> = [];
    for (let round = 0; round < PAGE_READY_ROUNDS; round += 1) {
      const title = `History Page ${round.toString().padStart(2, "0")}`;
      fixturePages.push({
        ...await createConvergenceBoardPage(
          setupPage,
          project,
          title,
          `Deterministic Page-ready fixture ${round}`,
        ),
        title,
      });
    }

    await stopApplication(application);
    application = undefined;
    await shutdownTemporaryCore(nodexHome);
    const history = seedSyntheticLocalCommitHistory(
      nodexHome,
      PAGE_READY_HISTORY_COMMITS,
    );
    expect(history).toMatchObject({
      commitCountAfter: PAGE_READY_HISTORY_COMMITS,
      storeVersion: 110,
    });

    application = await launchApplication(fixtureRoot, nodexHome);
    const page = await application.firstWindow();
    await page.evaluate(() => window.api?.awaitInitialization?.());
    await page.evaluate(() => {
      const target = globalThis as typeof globalThis & {
        __nodexPageReadyLongTasks?: number[];
      };
      target.__nodexPageReadyLongTasks = [];
      if (typeof PerformanceObserver === "undefined") return;
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          target.__nodexPageReadyLongTasks?.push(entry.duration);
        }
      });
      observer.observe({ type: "longtask", buffered: true });
    });
    const coreClient = await CoreClient.connect({
      nodexHome,
      clientKind: "test",
      buildId: "page-ready-history-e2e",
      requestTimeoutMs: 60_000,
    });
    const healthBefore = await coreClient.health();
    expect(healthBefore.metrics.commit_head).toBeGreaterThanOrEqual(
      history.commitHeadAfter,
    );

    await page.getByRole("button", {
      name: "Open Large history Page ready",
      exact: true,
    }).click();
    await page.getByRole("tab", { name: "Project Home" }).waitFor();
    await expect.poll(
      async () => await page.locator("[data-board-uuid-v7]").count(),
      { timeout: 15_000 },
    ).toBe(PAGE_READY_ROUNDS);

    const pageReadySamples: Array<{
      readonly cold: boolean;
      readonly durationMs: number;
      readonly round: number;
    }> = [];
    for (const [round, fixturePage] of fixturePages.entries()) {
      const card = page.locator(
        `[data-board-uuid-v7="${fixturePage.pageId}"]`,
      );
      await expect(card).toBeVisible({ timeout: 15_000 });
      await page.evaluate((loadingLabel) => {
        const target = globalThis as typeof globalThis & {
          __nodexPageReadyMeasurement?: {
            durationMs: number | null;
            skeletonAt: number | null;
            startedAt: number;
          };
        };
        const measurement: {
          durationMs: number | null;
          skeletonAt: number | null;
          startedAt: number;
        } = {
          durationMs: null,
          skeletonAt: null,
          startedAt: performance.now(),
        };
        target.__nodexPageReadyMeasurement = measurement;
        const sample = (): boolean => {
          if (
            measurement.skeletonAt === null
            && [...document.querySelectorAll<HTMLElement>('[role="status"][aria-busy="true"]')]
              .some((status) => status.getAttribute("aria-label") === loadingLabel)
          ) {
            measurement.skeletonAt = performance.now();
          }
          if (measurement.skeletonAt === null) return false;
          const editor = document.querySelector(
            '[data-page-stage-surface="true"] '
              + '.nfm-editor .ProseMirror[contenteditable="true"]',
          );
          if (!editor) return false;
          measurement.durationMs = performance.now() - measurement.skeletonAt;
          return true;
        };
        const observer = new MutationObserver(() => {
          if (sample()) observer.disconnect();
        });
        observer.observe(document.documentElement, {
          childList: true,
          subtree: true,
        });
        if (sample()) observer.disconnect();
      }, `Loading ${fixturePage.title}`);
      await card.click({ force: true });
      await expect.poll(async () => await page.evaluate(() => (
        globalThis as typeof globalThis & {
          __nodexPageReadyMeasurement?: { durationMs: number | null };
        }
      ).__nodexPageReadyMeasurement?.durationMs ?? null), {
        timeout: 15_000,
      }).not.toBeNull();
      const durationMs = await page.evaluate(() => (
        globalThis as typeof globalThis & {
          __nodexPageReadyMeasurement?: { durationMs: number | null };
        }
      ).__nodexPageReadyMeasurement?.durationMs ?? Number.NaN);
      if (!Number.isFinite(durationMs)) {
        throw new Error("Page editor readiness measurement is missing");
      }
      await page.getByRole("tab", { name: fixturePage.title, exact: true }).waitFor();
      const editor = page.locator(
        '[data-page-stage-surface="true"]:visible '
          + '.nfm-editor .ProseMirror[contenteditable="true"]',
      ).last();
      await expect(editor).toBeVisible({ timeout: 15_000 });
      pageReadySamples.push({
        cold: round === 0,
        durationMs,
        round,
      });
      await page.getByRole("button", {
        name: `Close ${fixturePage.title} tab`,
        exact: true,
      }).click({ force: true });
      await expect(page.getByRole("tab", {
        name: fixturePage.title,
        exact: true,
      })).toHaveCount(0);
      await page.evaluate(async () => {
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        });
      });
      await page.waitForTimeout(100);
    }
    const pageReadySummary = summarizeDurations(
      pageReadySamples.map((sample) => sample.durationMs),
    );
    const normalizedOneMinuteLoad = os.loadavg()[0] / Math.max(1, os.cpus().length);
    const noisyEnvironment = normalizedOneMinuteLoad >= 1;
    const frozenBaselineUpperBoundMs = 92;
    const medianDeltaRatio = (
      pageReadySummary.p50 - frozenBaselineUpperBoundMs
    ) / frozenBaselineUpperBoundMs;
    console.info(`[page-ready-samples] ${JSON.stringify(pageReadySamples)}`);
    if (noisyEnvironment) {
      expect(medianDeltaRatio).toBeLessThanOrEqual(0.1);
    } else {
      expect(pageReadySummary.p95).toBeLessThanOrEqual(112);
      expect(pageReadySummary.p95).toBeLessThanOrEqual(150);
    }

    await page.waitForTimeout(2_000);
    const electronCpuBefore = await readElectronProcessCpu(application);
    const coreCpuBefore = readProcessCpuTime(coreClient.handshake.generation.pid);
    const coreCpuPercentSamples: number[] = [];
    const electronCpuPercentSamples: Array<readonly ElectronProcessCpuSample[]> = [];
    for (let second = 0; second < IDLE_CPU_SAMPLE_SECONDS; second += 1) {
      coreCpuPercentSamples.push(
        readProcessCpuPercent(coreClient.handshake.generation.pid),
      );
      electronCpuPercentSamples.push(await readElectronProcessCpu(application));
      await page.waitForTimeout(1_000);
    }
    const coreCpuAfter = readProcessCpuTime(coreClient.handshake.generation.pid);
    const electronCpuAfter = await readElectronProcessCpu(application);
    const healthAfter = await coreClient.health();
    const coreCpuDeltaSeconds = Math.max(0, coreCpuAfter - coreCpuBefore);
    const electronCpuDeltaSeconds = cumulativeElectronCpuDelta(
      electronCpuBefore,
      electronCpuAfter,
    );
    const coreAverageCores = coreCpuDeltaSeconds / IDLE_CPU_SAMPLE_SECONDS;
    expect(coreAverageCores).toBeLessThanOrEqual(0.05);
    expect(Math.max(0, ...coreCpuPercentSamples)).toBeLessThan(100);
    expect(healthAfter.metrics.event_replay_lag_max).toBe(
      healthBefore.metrics.event_replay_lag_max,
    );
    expect(healthAfter.metrics.writer_queue_depth).toBe(0);
    expect(healthAfter.metrics.active_writer_commands).toBe(0);

    const rendererLongTasks = await page.evaluate(() => [
      ...((globalThis as typeof globalThis & {
        __nodexPageReadyLongTasks?: number[];
      }).__nodexPageReadyLongTasks ?? []),
    ]);
    const appMetrics = await application.evaluate(({ app }) => app.getAppMetrics());
    const metrics = {
      capturedAt: new Date().toISOString(),
      gitSha: execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: repositoryRoot,
        encoding: "utf8",
      }).trim(),
      buildMode: process.env.NODEX_CORE_EXECUTABLE?.includes("/release/")
        ? "electron-test-release-core"
        : "electron-test-debug-core",
      fixtureSeed: "page-ready-v1-20-pages-14419-local-commits",
      hardware: {
        architecture: process.arch,
        cpuCount: os.cpus().length,
        cpuModel: os.cpus()[0]?.model ?? "unknown",
        osRelease: os.release(),
        platform: process.platform,
        totalMemoryBytes: os.totalmem(),
        normalizedOneMinuteLoad,
      },
      history,
      pageReady: {
        samples: pageReadySamples,
        p50Ms: pageReadySummary.p50,
        p95Ms: pageReadySummary.p95,
        maxMs: pageReadySummary.max,
        preCommitP95UpperBoundMs: 92,
        allowedP95Ms: 112,
        absoluteGateMs: 150,
        medianDeltaRatio,
        noisyEnvironment,
        verdictBasis: noisyEnvironment
          ? "median-vs-frozen-pre-commit-upper-bound"
          : "p95",
      },
      globalReplay: {
        eventReplayLagMaxBefore: healthBefore.metrics.event_replay_lag_max,
        eventReplayLagMaxAfter: healthAfter.metrics.event_replay_lag_max,
        publicationCountBefore:
          healthBefore.metrics.local_commit_publication_duration.count,
        publicationCountAfter:
          healthAfter.metrics.local_commit_publication_duration.count,
      },
      idleCpu: {
        sampleSeconds: IDLE_CPU_SAMPLE_SECONDS,
        corePid: coreClient.handshake.generation.pid,
        coreCpuDeltaSeconds,
        coreAverageCores,
        corePercentSamples: coreCpuPercentSamples,
        electronCpuDeltaSeconds,
        aggregateCpuDeltaSeconds: coreCpuDeltaSeconds + electronCpuDeltaSeconds,
        electronPercentSamples: electronCpuPercentSamples,
      },
      renderer: {
        longTaskCount: rendererLongTasks.length,
        maxLongTaskMs: Math.max(0, ...rendererLongTasks),
        peakWorkingSetBytes: Math.max(
          0,
          ...appMetrics.map((metric) => metric.memory.peakWorkingSetSize * 1_024),
        ),
      },
      healthAfter: {
        activeDocumentSubscriptions: healthAfter.metrics.active_document_subscriptions,
        activeEventSubscriptions: healthAfter.metrics.active_event_subscriptions,
        activeReadCommands: healthAfter.metrics.active_read_commands,
        activeWriterCommands: healthAfter.metrics.active_writer_commands,
        documentCacheEntries: healthAfter.metrics.document_cache_entries,
        writerQueueDepth: healthAfter.metrics.writer_queue_depth,
      },
    };
    const metricsPath = testInfo.outputPath("page-ready-14k-history-raw.json");
    fs.writeFileSync(metricsPath, `${JSON.stringify(metrics, null, 2)}\n`);
    await testInfo.attach("page-ready-14k-history-raw", {
      path: metricsPath,
      contentType: "application/json",
    });
    console.info(`[page-ready-14k-history] ${JSON.stringify({
      coreAverageCores,
      pageReadyP95Ms: pageReadySummary.p95,
      pageReadyMaxMs: pageReadySummary.max,
    })}`);
  } finally {
    if (application) await stopApplication(application);
    await shutdownTemporaryCore(nodexHome);
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("converges a high-pressure Page promotion across tab groups and WebContents", async ({}, testInfo) => {
  test.setTimeout(180_000);
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nx-cross-tab-"));
  const nodexHome = path.join(fixtureRoot, "profile");
  const workspace = path.join(fixtureRoot, "workspace");
  fs.mkdirSync(workspace, { recursive: true });
  prepareRuntimeFixture(fixtureRoot);

  let application: ElectronApplication | undefined;
  try {
    application = await launchApplication(fixtureRoot, nodexHome);
    const page = await application.firstWindow();
    await page.evaluate(() => window.api?.awaitInitialization?.());

    const project = await createConvergenceProject(
      page,
      "Cross-tab Board stress",
      workspace,
    );
    const database = await readConvergenceDatabase(page, project);
    const initialTriageFixturePageCount = HIGH_PRESSURE_BOARD_TRIAGE_PAGE_COUNT - 1;
    const boardFixture = await createConvergencePage(
      page,
      project,
      "Board fixture seed",
    );
    const seededBoard = await seedConvergenceDocument(
      page,
      project,
      boardFixture,
      buildBoardFixtureNfm(),
    );
    const boardTriageFixturePageIds = await transferBoardFixturePages(
      page,
      project,
      database,
      seededBoard.documentId,
      seededBoard.blockIds.slice(1, initialTriageFixturePageCount + 1),
      "triage",
      "Seed cross-tab Triage Pages",
    );
    const boardPlanFixturePageIds = await transferBoardFixturePages(
      page,
      project,
      database,
      seededBoard.documentId,
      seededBoard.blockIds.slice(
        initialTriageFixturePageCount + 1,
        HIGH_PRESSURE_BOARD_PAGE_COUNT,
      ),
      "plan",
      "Seed cross-tab Plan Pages",
    );
    expect(boardTriageFixturePageIds).toHaveLength(initialTriageFixturePageCount);
    expect(boardPlanFixturePageIds).toHaveLength(HIGH_PRESSURE_BOARD_PLAN_PAGE_COUNT);
    const triageAnchorPageId = requireString(
      boardTriageFixturePageIds[0],
      "Cross-tab Triage anchor Page id",
    );
    const source = await createConvergenceBoardPage(
      page,
      project,
      "Cross-tab source",
      buildHighPressureSourceNfm("title-A-cross-tab"),
    );
    const seededSource = await seedConvergenceDocument(
      page,
      project,
      source,
      buildHighPressureSourceNfm("title-A-cross-tab"),
    );
    expect(seededSource.blockIds).toHaveLength(
      HIGH_PRESSURE_SIBLING_BLOCK_COUNT * 2
        + HIGH_PRESSURE_CHILD_BLOCK_COUNT
        + 1,
    );

    await page.getByRole("button", {
      name: "Open Cross-tab Board stress",
      exact: true,
    }).click();
    await page.getByRole("tab", { name: "Project Home" }).waitFor();
    const triageColumn = page.locator(
      '[data-board-column-root][data-board-column-id="triage"]',
    );
    await expect(triageColumn).toBeVisible({ timeout: 15_000 });
    await expect.poll(
      async () => await page.locator("[data-board-uuid-v7]").count(),
      { timeout: 15_000 },
    ).toBe(HIGH_PRESSURE_BOARD_PAGE_COUNT);

    const sourceCard = page.locator(`[data-board-uuid-v7="${source.pageId}"]`);
    await expect(sourceCard).toBeVisible({ timeout: 15_000 });
    await sourceCard.click();
    await page.getByRole("tab", { name: "Cross-tab source" }).waitFor();
    await expect(triageColumn).toBeVisible({ timeout: 15_000 });

    const sourceEditor = page.locator(
      '.nfm-editor .ProseMirror[contenteditable="true"]',
    ).last();
    await expect(sourceEditor).toBeVisible({ timeout: 15_000 });
    const titleBlock = sourceEditor.locator(".bn-block[data-id]").filter({
      hasText: "title-A-cross-tab",
    }).first();
    await expect(titleBlock).toBeVisible({ timeout: 15_000 });

    const audienceWindowOpened = application.waitForEvent("window");
    expect(await invokeIpc(page, "window:new", {})).toBe(true);
    const audiencePage = await audienceWindowOpened;
    await audiencePage.evaluate(() => window.api?.awaitInitialization?.());
    await audiencePage.getByRole("button", {
      name: "Open Cross-tab Board stress",
      exact: true,
    }).click();
    await audiencePage.getByRole("tab", { name: "Project Home" }).waitFor();
    const webContentsIds = await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .filter((window) => !window.isDestroyed())
        .map((window) => window.webContents.id)
    );
    expect(new Set(webContentsIds).size).toBeGreaterThanOrEqual(2);

    const audienceTriageColumn = audiencePage.locator(
      '[data-board-column-root][data-board-column-id="triage"]',
    );
    await expect(audienceTriageColumn).toBeVisible({ timeout: 15_000 });
    await expect.poll(
      async () => await audiencePage.locator("[data-board-uuid-v7]").count(),
      { timeout: 15_000 },
    ).toBe(HIGH_PRESSURE_BOARD_PAGE_COUNT);
    const audienceSourceCard = audiencePage.locator(
      `[data-board-uuid-v7="${source.pageId}"]`,
    );
    await expect(audienceSourceCard).toBeVisible({ timeout: 15_000 });
    await audienceSourceCard.locator('[data-card-context-menu-trigger="true"]')
      .evaluate((element) => (element as HTMLElement).click());
    await audiencePage.getByRole("tab", { name: "Cross-tab source" }).waitFor();
    await expect(audienceTriageColumn).toBeVisible({ timeout: 15_000 });
    const audienceSourceEditor = audiencePage.locator(
      '.nfm-editor .ProseMirror[contenteditable="true"]',
    ).last();
    await expect(audienceSourceEditor).toBeVisible({ timeout: 15_000 });
    const audienceTitleBlock = audienceSourceEditor
      .locator(".bn-block[data-id]")
      .filter({ hasText: "title-A-cross-tab" })
      .first();
    await expect(audienceTitleBlock).toBeVisible({ timeout: 15_000 });

    const triageBeforeTransfer = requireIpcValue<Record<string, unknown>>(
      await invokeIpc(page, "database:view-window:get", project.projectId, {
        databaseViewId: database.viewId,
        groupScope: { kind: "key", key: "triage" },
        first: HIGH_PRESSURE_BOARD_TRIAGE_PAGE_COUNT,
      }),
      "Read canonical Triage coordinate before cross-tab promotion",
    );
    const projectionBeforeTransfer = triageBeforeTransfer.projection;
    if (!isRecord(projectionBeforeTransfer)) {
      throw new Error("Canonical Triage window returned no projection coordinate");
    }

    await audiencePage.evaluate(() => {
      const target = globalThis as typeof globalThis & {
        __nodexRecipientDeliveries?: unknown[];
      };
      target.__nodexRecipientDeliveries = [];
      window.api?.on("recipient-delivery:message", (...args: unknown[]) => {
        target.__nodexRecipientDeliveries?.push(args[0]);
      });
    });

    const sourceDescriptorBefore = requireIpcValue<Record<string, unknown>>(
      await invokeIpc(
        page,
        "block-document:owned:prepare",
        project.projectId,
        source.pageId,
      ),
      "Read source Page Document before promotion",
    );
    const sourceGeneration = sourceDescriptorBefore.generation;
    const sourceHeadSeq = sourceDescriptorBefore.headSeq;
    if (
      typeof sourceGeneration !== "number"
      || typeof sourceHeadSeq !== "number"
    ) {
      throw new Error("Cross-tab source Page did not expose a causal Document head");
    }

    // Native pointer DnD has its dedicated isolated smoke above. Keep this
    // high-pressure gate at the renderer IPC mutation boundary while both real
    // destination/source surfaces remain mounted, then verify the complete
    // publication outcome without conflating gesture and convergence pressure.
    const startedAt = performance.now();
    const transferCommand = await invokeIpc(
        page,
        "blocks:transfer",
        project.projectId,
        {
          version: 2,
          operationId: createUuidV7(),
          projectId: project.projectId,
          storeEpoch: project.storeEpoch,
          mode: "move",
          rootBlockIds: [seededSource.blockIds[HIGH_PRESSURE_SIBLING_BLOCK_COUNT]],
          causalDependencies: [{
            documentId: seededSource.documentId,
            generation: sourceGeneration,
            expectedHeadSeq: sourceHeadSeq,
          }],
          source: { kind: "page", pageId: source.pageId },
          target: {
            kind: "data_source",
            dataSourceId: database.dataSourceId,
            viewId: database.viewId,
            groupKey: "triage",
            beforePageId: triageAnchorPageId,
          },
        },
      );
    const transfer = requireIpcValue<Record<string, unknown>>(
      transferCommand,
      "Promote title-A in the live cross-tab surfaces",
    );
    const committedAt = performance.now();
    const commitSeq = transfer.commitSeq;
    if (typeof commitSeq !== "number") {
      throw new Error("Cross-tab promotion returned no LocalCommit sequence");
    }
    expect(transferCommand).toMatchObject({
      ok: true,
      localCommit: {
        status: "committed",
        commit: { commit_seq: commitSeq },
        delivery: {
          projection_effects: expect.arrayContaining([
            expect.objectContaining({
              patch: expect.objectContaining({
                kind: "database_row_upsert",
                view_id: database.viewId,
              }),
            }),
          ]),
        },
      },
    });
    const localCommit = isRecord(transferCommand)
      ? transferCommand.localCommit
      : undefined;
    const delivery = isRecord(localCommit) ? localCommit.delivery : undefined;
    const effects = isRecord(delivery) && Array.isArray(delivery.projection_effects)
      ? delivery.projection_effects
      : [];
    const boardEffect = effects.find((effect) => {
      if (!isRecord(effect) || !isRecord(effect.patch)) return false;
      return effect.patch.kind === "database_row_upsert"
        && effect.patch.view_id === database.viewId;
    });
    if (!isRecord(boardEffect)) {
      throw new Error("Cross-tab promotion returned no Board projection effect");
    }
    expect(boardEffect).toMatchObject({
      base_revision: projectionBeforeTransfer.revision,
      result_revision: Number(projectionBeforeTransfer.revision) + 1,
      scope: {
        canonical_key: projectionBeforeTransfer.scopeKey,
        schema_version: projectionBeforeTransfer.schemaVersion,
      },
    });
    if (!Array.isArray(transfer.resultRootBlockIds)) {
      throw new Error("Cross-tab promotion returned no result Page ids");
    }
    expect(transfer.resultRootBlockIds).toHaveLength(1);
    const resultPageId = requireString(
      transfer.resultRootBlockIds[0],
      "Cross-tab promoted Page id",
    );
    const groupsAfterTransfer = requireIpcValue<Record<string, unknown>>(
      await invokeIpc(
        page,
        "database:view-groups:get",
        project.projectId,
        {
          databaseViewId: database.viewId,
          minimumCommitSeq: commitSeq,
        },
      ),
      "Read canonical Board totals after cross-tab promotion",
    );
    expect(groupsAfterTransfer.totalRows).toBe(HIGH_PRESSURE_BOARD_PAGE_COUNT + 1);
    const triageAfterTransfer = requireIpcValue<Record<string, unknown>>(
      await invokeIpc(
        page,
        "database:view-window:get",
        project.projectId,
        {
          databaseViewId: database.viewId,
          groupScope: { kind: "key", key: "triage" },
          first: HIGH_PRESSURE_BOARD_TRIAGE_PAGE_COUNT + 1,
          minimumCommitSeq: commitSeq,
        },
      ),
      "Read canonical Triage window after cross-tab promotion",
    );
    expect(triageAfterTransfer.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        page: expect.objectContaining({ id: resultPageId }),
      }),
    ]));
    try {
      await expect.poll(async () => await audiencePage.evaluate((targetCommitSeq) => {
        const deliveries = (
          globalThis as typeof globalThis & {
            __nodexRecipientDeliveries?: Array<Record<string, unknown>>;
          }
        ).__nodexRecipientDeliveries ?? [];
        return deliveries.some((delivery) => {
          const payload = delivery.payload as Record<string, unknown> | undefined;
          const packet = payload?.packet as Record<string, unknown> | undefined;
          const manifest = packet?.manifest as Record<string, unknown> | undefined;
          const identity = manifest?.identity as Record<string, unknown> | undefined;
          return payload?.kind === "packet"
            && identity?.commit_seq === targetCommitSeq;
        });
      }, commitSeq), { timeout: 5_000 }).toBe(true);
    } catch (error) {
      const deliveries = await audiencePage.evaluate(() => (
        globalThis as typeof globalThis & {
          __nodexRecipientDeliveries?: unknown[];
        }
      ).__nodexRecipientDeliveries ?? []);
      console.info(`[cross-webcontents-recipient-deliveries] ${JSON.stringify(deliveries)}`);
      throw error;
    }
    const audienceAdmittedAt = performance.now();
    const recipientDeliverySummary = await audiencePage.evaluate((targetCommitSeq) => {
      const deliveries = (
        globalThis as typeof globalThis & {
          __nodexRecipientDeliveries?: Array<Record<string, unknown>>;
        }
      ).__nodexRecipientDeliveries ?? [];
      return deliveries.flatMap((delivery) => {
        const payload = delivery.payload as Record<string, unknown> | undefined;
        const packet = payload?.packet as Record<string, unknown> | undefined;
        const manifest = packet?.manifest as Record<string, unknown> | undefined;
        const identity = manifest?.identity as Record<string, unknown> | undefined;
        if (payload?.kind !== "packet" || identity?.commit_seq !== targetCommitSeq) {
          return [];
        }
        const effects = Array.isArray(packet?.projection_effects)
          ? packet.projection_effects
          : [];
        return effects.flatMap((candidate) => {
          if (
            typeof candidate !== "object"
            || candidate === null
            || Array.isArray(candidate)
          ) return [];
          const effect = candidate as Record<string, unknown>;
          if (
            typeof effect.patch !== "object"
            || effect.patch === null
            || Array.isArray(effect.patch)
          ) return [];
          const patch = effect.patch as Record<string, unknown>;
          return [{
            deliveryId: delivery.deliveryId,
            recipientLeaseId: delivery.recipientLeaseId,
            address: delivery.deliveryAddress,
            baseRevision: effect.base_revision,
            resultRevision: effect.result_revision,
            patchKind: patch.kind,
            viewId: patch.view_id,
          }];
        });
      });
    }, commitSeq);
    expect(recipientDeliverySummary).toEqual(expect.arrayContaining([
      expect.objectContaining({
        deliveryId: expect.stringMatching(/^[a-f0-9]{64}$/u),
        recipientLeaseId: expect.stringMatching(/^[a-f0-9]{64}$/u),
        address: expect.objectContaining({
          kind: "project",
          project_id: project.projectId,
        }),
        patchKind: "database_row_upsert",
        viewId: database.viewId,
      }),
    ]));
    const transferredCard = page.locator('[data-board-uuid-v7]').filter({
      hasText: "title-A-cross-tab",
    }).first();
    const audienceTransferredCard = audiencePage
      .locator('[data-board-uuid-v7]')
      .filter({ hasText: "title-A-cross-tab" })
      .first();
    const [cardVisibleAt, sourceRemovedAt, audienceCardVisibleAt, audienceSourceRemovedAt] =
      await Promise.all([
      expect(transferredCard).toBeVisible({ timeout: 15_000 })
        .then(async () => {
          await expect(transferredCard).toContainText("title-A-cross-tab");
          return performance.now();
        }),
      expect(titleBlock).toHaveCount(0, { timeout: 15_000 })
        .then(() => performance.now()),
      expect(audienceTransferredCard).toBeVisible({ timeout: 15_000 })
        .then(async () => {
          await expect(audienceTransferredCard).toContainText("title-A-cross-tab");
          return performance.now();
        }),
      expect(audienceTitleBlock).toHaveCount(0, { timeout: 15_000 })
        .then(() => performance.now()),
    ]);
    const sourceDescriptorAfter = requireIpcValue<Record<string, unknown>>(
      await invokeIpc(
        page,
        "block-document:owned:prepare",
        project.projectId,
        source.pageId,
      ),
      "Read source Page Document after promotion",
    );
    expect(sourceDescriptorAfter).toMatchObject({
      documentId: seededSource.documentId,
      headSeq: expect.any(Number),
    });
    expect(sourceDescriptorAfter.headSeq).toBeGreaterThan(2);

    const detail = requireIpcValue<Record<string, unknown>>(
      await invokeIpc(
        page,
        "pages:detail:get",
        project.projectId,
        resultPageId,
      ),
      "Read cross-tab transferred Page detail",
    );
    expect(detail.page).toMatchObject({
      title: "title-A-cross-tab",
      parent: {
        kind: "data_source",
        dataSourceId: database.dataSourceId,
      },
    });
    expect(detail.page).toMatchObject({
      plainText: expect.stringContaining("child-placeholder-000"),
    });
    expect(detail.page).toMatchObject({
      plainText: expect.stringContaining("child-placeholder-099"),
    });
    expect(await sourceEditor.locator(".bn-block[data-id]").count()).toBe(
      HIGH_PRESSURE_SIBLING_BLOCK_COUNT * 2,
    );
    expect(await audienceSourceEditor.locator(".bn-block[data-id]").count()).toBe(
      HIGH_PRESSURE_SIBLING_BLOCK_COUNT * 2,
    );

    const metrics = {
      fixtureSeed: "cross-tab-board-transfer-v1-100x100x100",
      boardInitialPageCount: HIGH_PRESSURE_BOARD_PAGE_COUNT,
      sourceBlockCount:
        HIGH_PRESSURE_SIBLING_BLOCK_COUNT * 2
        + HIGH_PRESSURE_CHILD_BLOCK_COUNT
        + 1,
      movedChildBlockCount: HIGH_PRESSURE_CHILD_BLOCK_COUNT,
      requestToCommitMs: committedAt - startedAt,
      commitToCardMs: cardVisibleAt - committedAt,
      commitToSourceRemovalMs: sourceRemovedAt - committedAt,
      commitToAudienceAdmissionObservedMs: audienceAdmittedAt - committedAt,
      commitToAudienceCardMs: audienceCardVisibleAt - committedAt,
      commitToAudienceSourceRemovalMs: audienceSourceRemovedAt - committedAt,
      requestToCardMs: cardVisibleAt - startedAt,
      requestToSourceRemovalMs: sourceRemovedAt - startedAt,
      transferPath: "origin-apply-response-plus-audience-scanner",
      webContentsCount: new Set(webContentsIds).size,
      commitSeq,
    };
    const metricsPath = testInfo.outputPath("cross-tab-transfer-performance.json");
    fs.writeFileSync(metricsPath, `${JSON.stringify(metrics, null, 2)}\n`);
    await testInfo.attach("cross-tab-transfer-performance", {
      path: metricsPath,
      contentType: "application/json",
    });
    console.info(`[cross-tab-transfer-performance] ${JSON.stringify(metrics)}`);
  } finally {
    if (application) await stopApplication(application);
    await shutdownTemporaryCore(nodexHome);
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("measures high-pressure nested Block transfer into a populated Board", async ({}, testInfo) => {
  test.setTimeout(HIGH_PRESSURE_TEST_TIMEOUT_MS);
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nx-board-stress-"));
  const nodexHome = path.join(fixtureRoot, "profile");
  const workspace = path.join(fixtureRoot, "workspace");
  fs.mkdirSync(workspace, { recursive: true });
  prepareRuntimeFixture(fixtureRoot);

  let application: ElectronApplication | undefined;
  try {
    application = await launchApplication(fixtureRoot, nodexHome);
    const page = await application.firstWindow();
    await page.evaluate(() => window.api?.awaitInitialization?.());

    const project = await createConvergenceProject(
      page,
      "Board stress convergence",
      workspace,
    );
    const fixturePreparationStartedAt = performance.now();
    const boardSeedPage = await createConvergencePage(page, project, "Board fixture seed");
    const seededBoard = await seedConvergenceDocument(
      page,
      project,
      boardSeedPage,
      buildBoardFixtureNfm(),
    );
    expect(seededBoard.blockIds).toHaveLength(HIGH_PRESSURE_BOARD_PAGE_COUNT + 1);
    const database = await readConvergenceDatabase(page, project);

    const boardFixtureRootBlockIds = seededBoard.blockIds.slice(1);
    const triageFixturePageIds = await transferBoardFixturePages(
      page,
      project,
      database,
      seededBoard.documentId,
      boardFixtureRootBlockIds.slice(0, HIGH_PRESSURE_BOARD_TRIAGE_PAGE_COUNT),
      "triage",
      "Create populated Triage fixture",
    );
    const planFixturePageIds = await transferBoardFixturePages(
      page,
      project,
      database,
      seededBoard.documentId,
      boardFixtureRootBlockIds.slice(HIGH_PRESSURE_BOARD_TRIAGE_PAGE_COUNT),
      "plan",
      "Create populated Plan fixture",
    );
    expect(triageFixturePageIds).toHaveLength(HIGH_PRESSURE_BOARD_TRIAGE_PAGE_COUNT);
    expect(planFixturePageIds).toHaveLength(HIGH_PRESSURE_BOARD_PLAN_PAGE_COUNT);
    const firstTriagePageId = requireString(
      triageFixturePageIds[0],
      "First Triage fixture Page id",
    );
    expect(await readConvergenceBoardTotal(page, project)).toBe(
      HIGH_PRESSURE_BOARD_PAGE_COUNT,
    );

    const blocksPerRound =
      HIGH_PRESSURE_SIBLING_BLOCK_COUNT * 2
      + HIGH_PRESSURE_CHILD_BLOCK_COUNT
      + 1;
    const openProjectStartedAt = performance.now();
    await page.getByRole("button", {
      name: "Open Board stress convergence",
      exact: true,
    }).click();
    await page.getByRole("tab", { name: "Project Home" }).waitFor();
    const boardColumn = page.locator(
      '[data-board-column-root][data-board-column-id="triage"]',
    );
    await expect(boardColumn).toBeVisible({ timeout: 15_000 });
    const initialBoardCards = page.locator("[data-board-uuid-v7]");
    await expect.poll(
      async () => await initialBoardCards.count(),
      { timeout: 15_000 },
    ).toBe(HIGH_PRESSURE_BOARD_PAGE_COUNT);
    const boardInitialRenderMs = performance.now() - openProjectStartedAt;
    const initialDomNodes = await page.evaluate(
      () => document.getElementsByTagName("*").length,
    );

    await page.evaluate(() => {
      const state = {
        longTasks: [] as number[],
      };
      Object.defineProperty(window, "__nodexBoardTransferPerformance", {
        configurable: true,
        value: state,
      });
      if (typeof PerformanceObserver === "undefined") return;
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) state.longTasks.push(entry.duration);
      });
      observer.observe({ type: "longtask", buffered: true });
    });

    const transferCommitDurations: number[] = [];
    const transferToSourceRemovalDurations: number[] = [];
    const transferToCardDurations: number[] = [];
    const normalizedOneMinuteLoads: number[] = [];
    const coreStageDurations = {} as Record<CoreTransferStage, number[]>;
    const coreStageObservationCounts = {} as Record<CoreTransferStage, number>;
    let firstTransferVisibilityFacts: BoardTransferPerformanceMetrics["firstTransferVisibilityFacts"] = [];
    let firstTransferVisibilityRows: BoardTransferPerformanceMetrics["firstTransferVisibilityRows"] = [];
    for (const stage of Object.keys(CORE_TRANSFER_STAGES) as CoreTransferStage[]) {
      coreStageDurations[stage] = [];
      coreStageObservationCounts[stage] = 0;
    }
    const metricsClient = await CoreClient.connect({
      nodexHome,
      clientKind: "test",
      buildId: "electron-e2e-performance",
      requestTimeoutMs: 15_000,
    });
    let lastChangeLogSeq = 0;
    for (let index = 0; index < HIGH_PRESSURE_ROUNDS; index += 1) {
      // Keep the renderer interactive while fixture pressure is applied. A
      // pre-open burst of twenty large document commits measures startup
      // backlog instead of the transfer path and can hide the Board surface
      // behind its own projection work.
      const sourcePage = await createConvergencePage(
        page,
        project,
        `High pressure source ${index + 1}`,
      );
      const seededSource = await seedConvergenceDocument(
        page,
        project,
        sourcePage,
        buildHighPressureSourceNfm(`title-A-${index}`),
      );
      expect(seededSource.blockIds).toHaveLength(blocksPerRound);
      const titleBlockId = seededSource.blockIds[HIGH_PRESSURE_SIBLING_BLOCK_COUNT];
      if (!titleBlockId) throw new Error("High-pressure source title Block is missing");
      const coreMetricsBefore = (await metricsClient.health()).metrics;
      normalizedOneMinuteLoads.push(
        os.loadavg()[0] / Math.max(1, os.cpus().length),
      );
      const transferStartedAt = performance.now();
      const receipt = requireIpcValue<Record<string, unknown>>(
        await invokeIpc(
          page,
          "blocks:transfer",
          project.projectId,
          {
            version: 2,
            operationId: createUuidV7(),
            projectId: project.projectId,
            storeEpoch: project.storeEpoch,
            mode: "move",
            rootBlockIds: [titleBlockId],
            source: { kind: "document", documentId: seededSource.documentId },
            target: {
              kind: "data_source",
              dataSourceId: database.dataSourceId,
              viewId: database.viewId,
              groupKey: "triage",
              beforePageId: firstTriagePageId,
            },
          },
        ),
        `Transfer high-pressure title Block ${index + 1}`,
      );
      const transferCommittedAt = performance.now();
      const coreMetricsAfter = (await metricsClient.health()).metrics;
      for (const [stage, metricKey] of Object.entries(CORE_TRANSFER_STAGES) as Array<
        [CoreTransferStage, (typeof CORE_TRANSFER_STAGES)[CoreTransferStage]]
      >) {
        const delta = durationMetricDelta(coreMetricsBefore, coreMetricsAfter, metricKey);
        if (stage === "prepare" || stage === "apply") {
          expect(delta.observationCount).toBe(1);
        }
        coreStageDurations[stage].push(delta.durationMs);
        coreStageObservationCounts[stage] += delta.observationCount;
      }
      transferCommitDurations.push(transferCommittedAt - transferStartedAt);
      if (!Array.isArray(receipt.resultRootBlockIds)) {
        throw new Error("High-pressure Block transfer returned no result Page id");
      }
      const resultPageId = requireString(
        receipt.resultRootBlockIds[0],
        "High-pressure transferred Page id",
      );
      const commitSeq = receipt.commitSeq;
      if (typeof commitSeq !== "number") {
        throw new Error("High-pressure Block transfer returned no semantic commit sequence");
      }
      lastChangeLogSeq = commitSeq;
      if (index === 0) {
        firstTransferVisibilityFacts = readVisibilityFactCounts(nodexHome, commitSeq);
        firstTransferVisibilityRows = readVisibilityFactRows(nodexHome, commitSeq);
      }

      const evidence = Array.isArray(receipt.transformationEvidence)
        ? receipt.transformationEvidence.find((entry) =>
          isRecord(entry) && entry.sourceBlockId === titleBlockId)
        : undefined;
      if (!isRecord(evidence)) {
        throw new Error("High-pressure Block transfer returned no title transformation evidence");
      }
      expect(evidence.kind).toBe("promote");
      expect(evidence.resultPageId).toBe(resultPageId);
      expect(evidence.bodyRootBlockIds).toHaveLength(HIGH_PRESSURE_CHILD_BLOCK_COUNT);

      const card = page.locator(`[data-board-uuid-v7="${resultPageId}"]`);
      const sourceObservation = invokeIpc(
        page,
        "pages:detail:get",
        project.projectId,
        sourcePage.pageId,
        commitSeq,
      ).then((value) => ({
        observedAt: performance.now(),
        sourceDetail: requireIpcValue<Record<string, unknown>>(
          value,
          `Read high-pressure source Page ${index + 1} after transfer`,
        ),
      }));
      const cardObservation = expect(card).toBeVisible({ timeout: 15_000 })
        .then(async () => {
          await expect(card).toContainText(`title-A-${index}`);
          return performance.now();
        });
      const [{ observedAt: sourceObservedAt, sourceDetail }, cardVisibleAt] =
        await Promise.all([sourceObservation, cardObservation]);
      const sourcePageAfter = isRecord(sourceDetail.page)
        ? sourceDetail.page
        : null;
      const sourcePlainText = sourcePageAfter?.plainText;
      if (typeof sourcePlainText !== "string") {
        throw new Error("High-pressure source Page returned no plain text");
      }
      expect(sourcePlainText).toBe(HIGH_PRESSURE_SOURCE_REMAINDER);
      transferToSourceRemovalDurations.push(
        sourceObservedAt - transferCommittedAt,
      );
      transferToCardDurations.push(cardVisibleAt - transferCommittedAt);

      if (index === 0) {
        const detail = requireIpcValue<Record<string, unknown>>(
          await invokeIpc(
            page,
            "pages:detail:get",
            project.projectId,
            resultPageId,
            commitSeq,
          ),
          "Read high-pressure transferred Page detail",
        );
        expect(detail.page).toMatchObject({
          title: "title-A-0",
          parent: {
            kind: "data_source",
            dataSourceId: database.dataSourceId,
          },
        });
        expect(detail.page).toMatchObject({
          plainText: expect.stringContaining("child-placeholder-000"),
        });
        expect(detail.page).toMatchObject({
          plainText: expect.stringContaining("child-placeholder-099"),
        });
      }
      await expect.poll(
        async () => await readConvergenceBoardTotal(page, project, commitSeq),
        { timeout: 15_000 },
      ).toBe(HIGH_PRESSURE_BOARD_PAGE_COUNT + index + 1);
    }
    expect(await readConvergenceBoardTotal(page, project, lastChangeLogSeq)).toBe(
      HIGH_PRESSURE_BOARD_PAGE_COUNT + HIGH_PRESSURE_ROUNDS,
    );
    const transferCommitSummary = summarizeDurations(transferCommitDurations);
    const transferToSourceRemovalSummary = summarizeDurations(
      transferToSourceRemovalDurations,
    );
    const transferToCardSummary = summarizeDurations(transferToCardDurations);
    const coreStages = Object.fromEntries(
      Object.entries(coreStageDurations).map(([stage, durations]) => {
        const summary = summarizeDurations(durations);
        return [stage, {
          p50Ms: summary.p50,
          p95Ms: summary.p95,
          p99Ms: summary.p99,
          maxMs: summary.max,
          observationCount: coreStageObservationCounts[stage as CoreTransferStage],
        }];
      }),
    ) as Record<CoreTransferStage, CoreTransferStageSummary>;

    const rendererMetrics = await page.evaluate(() => {
      const state = (window as typeof window & {
        __nodexBoardTransferPerformance?: { longTasks: number[] };
      }).__nodexBoardTransferPerformance;
      const longTasks = [...(state?.longTasks ?? [])];
      return {
        finalDomNodes: document.getElementsByTagName("*").length,
        rendererLongTaskCount: longTasks.length,
        rendererLongTaskTotalMs: longTasks.reduce((sum, duration) => sum + duration, 0),
        rendererMaxLongTaskMs: Math.max(0, ...longTasks),
      };
    });
    const peakWorkingSetBytes = await application.evaluate(({ app }) =>
      Math.max(
        0,
        ...app.getAppMetrics().map((metric) => metric.memory.peakWorkingSetSize * 1_024),
      ));
    const cpus = os.cpus();
    const metrics: BoardTransferPerformanceMetrics = {
      fixtureSeed: "board-transfer-v1-100x100x100",
      buildMode: process.env.NODEX_CORE_EXECUTABLE?.includes("/release/")
        ? "electron-test-release-core"
        : "electron-test-debug-core",
      platform: process.platform,
      architecture: process.arch,
      osRelease: os.release(),
      cpuModel: cpus[0]?.model ?? "unknown",
      cpuCount: cpus.length,
      totalMemoryBytes: os.totalmem(),
      normalizedOneMinuteLoadAtStart: normalizedOneMinuteLoads[0] ?? 0,
      normalizedOneMinuteLoadMax: Math.max(0, ...normalizedOneMinuteLoads),
      fixturePreparationMs: performance.now() - fixturePreparationStartedAt,
      boardInitialRenderMs,
      transferCommitMs: transferCommitSummary.p50,
      transferToSourceRemovalMs: transferToSourceRemovalSummary.p50,
      transferToCardMs: transferToCardSummary.p50,
      endToEndMs: transferCommitSummary.p50 + transferToCardSummary.p50,
      sourceBlockCount: blocksPerRound,
      movedChildBlockCount: HIGH_PRESSURE_CHILD_BLOCK_COUNT,
      initialBoardPageCount: HIGH_PRESSURE_BOARD_PAGE_COUNT,
      finalBoardPageCount: HIGH_PRESSURE_BOARD_PAGE_COUNT + HIGH_PRESSURE_ROUNDS,
      initialRenderedBoardCardCount: HIGH_PRESSURE_BOARD_PAGE_COUNT,
      finalRenderedBoardCardCount: await page.locator("[data-board-uuid-v7]").count(),
      initialDomNodes,
      ...rendererMetrics,
      peakWorkingSetBytes,
      firstTransferVisibilityFacts,
      firstTransferVisibilityRows,
      transferCommitP50Ms: transferCommitSummary.p50,
      transferCommitP95Ms: transferCommitSummary.p95,
      transferCommitP99Ms: transferCommitSummary.p99,
      transferCommitMaxMs: transferCommitSummary.max,
      transferToSourceRemovalP50Ms: transferToSourceRemovalSummary.p50,
      transferToSourceRemovalP95Ms: transferToSourceRemovalSummary.p95,
      transferToSourceRemovalP99Ms: transferToSourceRemovalSummary.p99,
      transferToSourceRemovalMaxMs: transferToSourceRemovalSummary.max,
      transferToCardP50Ms: transferToCardSummary.p50,
      transferToCardP95Ms: transferToCardSummary.p95,
      transferToCardP99Ms: transferToCardSummary.p99,
      transferToCardMaxMs: transferToCardSummary.max,
      coreStages,
      rawSamples: {
        transferCommitMs: transferCommitDurations,
        transferToSourceRemovalMs: transferToSourceRemovalDurations,
        transferToCardMs: transferToCardDurations,
        normalizedOneMinuteLoad: normalizedOneMinuteLoads,
        coreStages: coreStageDurations,
      },
      rounds: HIGH_PRESSURE_ROUNDS,
    };
    const metricsPath = testInfo.outputPath("board-transfer-high-pressure-metrics.json");
    fs.writeFileSync(metricsPath, `${JSON.stringify(metrics, null, 2)}\n`);
    await testInfo.attach("board-transfer-high-pressure-metrics", {
      path: metricsPath,
      contentType: "application/json",
    });
    console.info(`[board-transfer-high-pressure] ${JSON.stringify(metrics)}`);

    expect(metrics.initialBoardPageCount).toBe(HIGH_PRESSURE_BOARD_PAGE_COUNT);
    expect(metrics.finalBoardPageCount).toBe(
      HIGH_PRESSURE_BOARD_PAGE_COUNT + HIGH_PRESSURE_ROUNDS,
    );
    expect(metrics.initialRenderedBoardCardCount).toBe(HIGH_PRESSURE_BOARD_PAGE_COUNT);
    expect(metrics.finalRenderedBoardCardCount).toBeGreaterThanOrEqual(
      metrics.initialRenderedBoardCardCount,
    );
    if (process.env.NODEX_SKIP_PERFORMANCE_GATES !== "1") {
      const isReleaseCore = metrics.buildMode === "electron-test-release-core";
      expect(metrics.transferCommitP95Ms).toBeLessThan(isReleaseCore ? 250 : 750);
      expect(metrics.transferToSourceRemovalP95Ms).toBeLessThan(100);
      expect(metrics.transferToCardP95Ms).toBeLessThan(100);
      if (isReleaseCore && metrics.rounds >= 100) {
        expect(metrics.transferCommitP99Ms).not.toBeNull();
        expect(metrics.transferCommitP99Ms ?? Number.POSITIVE_INFINITY).toBeLessThan(350);
        expect(metrics.transferToSourceRemovalP99Ms).not.toBeNull();
        expect(
          metrics.transferToSourceRemovalP99Ms ?? Number.POSITIVE_INFINITY,
        ).toBeLessThan(100);
        expect(metrics.transferToCardP99Ms).not.toBeNull();
        expect(metrics.transferToCardP99Ms ?? Number.POSITIVE_INFINITY).toBeLessThan(100);
      }
      expect(metrics.coreStages.writerQueueWait.p95Ms).toBeLessThan(5);
      expect(metrics.coreStages.prepare.p95Ms).toBeLessThan(50);
      expect(metrics.coreStages.packetPublication.p95Ms).toBeLessThan(5);
    }
  } finally {
    if (application) await stopApplication(application);
    await shutdownTemporaryCore(nodexHome);
    if (process.env.NODEX_KEEP_BOARD_TRANSFER_FIXTURE === "1") {
      console.info(`[board-transfer-fixture] ${fixtureRoot}`);
    } else {
      fs.rmSync(fixtureRoot, { recursive: true, force: true });
    }
  }
});

test("keeps representative large-content surfaces bounded in a real Electron renderer", async ({}, testInfo) => {
  test.setTimeout(180_000);
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-large-content-e2e-"));
  const builtFixtureDir = path.join(fixtureRoot, "renderer");
  const artifactDir = process.env.NODEX_LARGE_CONTENT_ARTIFACT_DIR
    ? path.resolve(process.env.NODEX_LARGE_CONTENT_ARTIFACT_DIR)
    : testInfo.outputPath("large-content-performance");
  fs.mkdirSync(artifactDir, { recursive: true });
  const fixtureFile = await buildLargeContentFixture(builtFixtureDir);

  let application: ElectronApplication | undefined;
  try {
    application = await launchLargeContentFixtureApplication();

    const scenarios: LargeContentScenario[] = [
      "license",
      "workspace",
      "markdown",
      "tool",
      "startup",
    ];
    const metrics: LargeContentScenarioMetrics[] = [];
    for (const scenario of scenarios) {
      metrics.push(await sampleLargeContentScenario({
        application,
        artifactDir,
        fixtureFile,
        scenario,
      }));
    }

    fs.writeFileSync(path.join(artifactDir, "metrics.json"), `${JSON.stringify({
      capturedAt: new Date().toISOString(),
      electron: process.versions.electron,
      fixtureSizes: LARGE_CONTENT_FIXTURE_SIZES,
      metrics,
    }, null, 2)}\n`);

    const byScenario = Object.fromEntries(metrics.map((metric) => [metric.scenario, metric]));
    const enforcePerformanceTiming = process.env.NODEX_SKIP_PERFORMANCE_GATES !== "1";
    if (enforcePerformanceTiming) {
      expect(byScenario.license?.maxLongTaskMs).toBeLessThanOrEqual(250);
      expect(byScenario.workspace?.maxLongTaskMs).toBeLessThanOrEqual(250);
      expect(byScenario.markdown?.maxLongTaskMs).toBeLessThanOrEqual(250);
      expect(byScenario.tool?.maxLongTaskMs).toBeLessThanOrEqual(250);
      expect(byScenario.startup?.maxLongTaskMs).toBeLessThanOrEqual(250);
    }
    expect(byScenario.license?.accessibilityNodes).toBeLessThanOrEqual(500);
    expect(byScenario.workspace?.domNodes).toBeLessThanOrEqual(2_000);
    expect(byScenario.workspace?.accessibilityNodes).toBeLessThanOrEqual(2_000);
    expect(byScenario.markdown?.domNodes).toBeLessThanOrEqual(2_000);
    expect(byScenario.markdown?.accessibilityNodes).toBeLessThanOrEqual(2_000);
    expect(byScenario.tool?.domNodes).toBeLessThanOrEqual(2_000);
    expect(byScenario.tool?.accessibilityNodes).toBeLessThanOrEqual(2_000);
    expect(byScenario.startup?.domNodes).toBeLessThanOrEqual(2_000);
  } finally {
    if (application) await stopApplication(application);
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});
