import { expect, test } from "@playwright/test";
import {
  _electron as electron,
  type CDPSession,
  type ElectronApplication,
  type Page,
} from "playwright";
import { createHash } from "node:crypto";
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

interface ConvergenceDatabase {
  dataSourceId: string;
  viewId: string;
}

interface BoardTransferPerformanceMetrics {
  fixturePreparationMs: number;
  boardInitialRenderMs: number;
  transferCommitMs: number;
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
}

const HIGH_PRESSURE_SIBLING_BLOCK_COUNT = 100;
const HIGH_PRESSURE_CHILD_BLOCK_COUNT = 100;
const HIGH_PRESSURE_BOARD_PAGE_COUNT = 100;
const HIGH_PRESSURE_BOARD_TRIAGE_PAGE_COUNT = 50;
const HIGH_PRESSURE_BOARD_PLAN_PAGE_COUNT =
  HIGH_PRESSURE_BOARD_PAGE_COUNT - HIGH_PRESSURE_BOARD_TRIAGE_PAGE_COUNT;

const buildHighPressureSourceNfm = (): string => [
  ...Array.from(
    { length: HIGH_PRESSURE_SIBLING_BLOCK_COUNT },
    (_, index) => `before-placeholder-${index.toString().padStart(3, "0")}`,
  ),
  "title-A",
  ...Array.from(
    { length: HIGH_PRESSURE_CHILD_BLOCK_COUNT },
    (_, index) => `\tchild-placeholder-${index.toString().padStart(3, "0")}`,
  ),
  ...Array.from(
    { length: HIGH_PRESSURE_SIBLING_BLOCK_COUNT },
    (_, index) => `after-placeholder-${index.toString().padStart(3, "0")}`,
  ),
].join("\n");

const buildBoardFixtureNfm = (): string => [
  "Keep board fixture",
  ...Array.from(
    { length: HIGH_PRESSURE_BOARD_PAGE_COUNT },
    (_, index) => `board-fixture-${index.toString().padStart(3, "0")}`,
  ),
].join("\n");

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
    await expect(page.locator('[data-kanban-column-id="triage"]')).toBeVisible({
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
    const changeLogSeq = receipt.changeLogSeq;
    if (typeof changeLogSeq !== "number") {
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
        changeLogSeq,
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

    const card = page.locator(`[data-kanban-uuid-v7="${resultPageId}"]`);
    await expect(card).toBeVisible({ timeout: 5_000 });
    await expect(card).toContainText("Dragged source");
  } finally {
    if (application) await stopApplication(application);
    await shutdownTemporaryCore(nodexHome);
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("measures high-pressure nested Block transfer into a populated Board", async ({}, testInfo) => {
  test.setTimeout(180_000);
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
    const triageFixtureTransfer = requireIpcValue<Record<string, unknown>>(
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
          rootBlockIds: boardFixtureRootBlockIds.slice(
            0,
            HIGH_PRESSURE_BOARD_TRIAGE_PAGE_COUNT,
          ),
          source: { kind: "document", documentId: seededBoard.documentId },
          target: {
            kind: "data_source",
            dataSourceId: database.dataSourceId,
            viewId: database.viewId,
            groupKey: "triage",
          },
        },
      ),
      "Create populated Triage fixture",
    );
    const planFixtureTransfer = requireIpcValue<Record<string, unknown>>(
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
          rootBlockIds: boardFixtureRootBlockIds.slice(
            HIGH_PRESSURE_BOARD_TRIAGE_PAGE_COUNT,
          ),
          source: { kind: "document", documentId: seededBoard.documentId },
          target: {
            kind: "data_source",
            dataSourceId: database.dataSourceId,
            viewId: database.viewId,
            groupKey: "plan",
          },
        },
      ),
      "Create populated Plan fixture",
    );
    expect(triageFixtureTransfer.resultRootBlockIds).toHaveLength(
      HIGH_PRESSURE_BOARD_TRIAGE_PAGE_COUNT,
    );
    expect(planFixtureTransfer.resultRootBlockIds).toHaveLength(
      HIGH_PRESSURE_BOARD_PLAN_PAGE_COUNT,
    );
    if (!Array.isArray(triageFixtureTransfer.resultRootBlockIds)) {
      throw new Error("Triage fixture transfer returned no Page ids");
    }
    const firstTriagePageId = requireString(
      triageFixtureTransfer.resultRootBlockIds[0],
      "First Triage fixture Page id",
    );
    expect(await readConvergenceBoardTotal(page, project)).toBe(
      HIGH_PRESSURE_BOARD_PAGE_COUNT,
    );

    const sourcePage = await createConvergencePage(
      page,
      project,
      "High pressure source",
    );
    const seededSource = await seedConvergenceDocument(
      page,
      project,
      sourcePage,
      buildHighPressureSourceNfm(),
    );
    const expectedSourceBlockCount =
      HIGH_PRESSURE_SIBLING_BLOCK_COUNT * 2
      + HIGH_PRESSURE_CHILD_BLOCK_COUNT
      + 1;
    expect(seededSource.blockIds).toHaveLength(expectedSourceBlockCount);
    const titleBlockId = seededSource.blockIds[HIGH_PRESSURE_SIBLING_BLOCK_COUNT];
    if (!titleBlockId) throw new Error("High-pressure source title Block is missing");

    const openProjectStartedAt = performance.now();
    await page.getByRole("button", {
      name: "Open Board stress convergence",
      exact: true,
    }).click();
    await page.getByRole("tab", { name: "Project Home" }).waitFor();
    const boardColumn = page.locator('[data-kanban-column-id="triage"]');
    await expect(boardColumn).toBeVisible({ timeout: 15_000 });
    const initialBoardCards = page.locator("[data-kanban-uuid-v7]");
    await expect.poll(
      async () => await initialBoardCards.count(),
      { timeout: 15_000 },
    ).toBe(HIGH_PRESSURE_BOARD_PAGE_COUNT);
    const boardInitialRenderMs = performance.now() - openProjectStartedAt;
    const initialDomNodes = await page.evaluate(
      () => document.getElementsByTagName("*").length,
    );

    await page.evaluate(() => {
      const state = { longTasks: [] as number[] };
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
      "Transfer high-pressure title Block into Board",
    );
    const transferCommittedAt = performance.now();
    if (!Array.isArray(receipt.resultRootBlockIds)) {
      throw new Error("High-pressure Block transfer returned no result Page id");
    }
    const resultPageId = requireString(
      receipt.resultRootBlockIds[0],
      "High-pressure transferred Page id",
    );
    const changeLogSeq = receipt.changeLogSeq;
    if (typeof changeLogSeq !== "number") {
      throw new Error("High-pressure Block transfer returned no change-log sequence");
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

    const detail = requireIpcValue<Record<string, unknown>>(
      await invokeIpc(
        page,
        "pages:detail:get",
        project.projectId,
        resultPageId,
        changeLogSeq,
      ),
      "Read high-pressure transferred Page detail",
    );
    expect(detail.page).toMatchObject({
      title: "title-A",
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

    const card = page.locator(`[data-kanban-uuid-v7="${resultPageId}"]`);
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card).toContainText("title-A");
    const cardVisibleAt = performance.now();
    await expect.poll(
      async () => await page.locator("[data-kanban-uuid-v7]").count(),
      { timeout: 15_000 },
    ).toBe(HIGH_PRESSURE_BOARD_PAGE_COUNT);
    expect(await readConvergenceBoardTotal(page, project, changeLogSeq)).toBe(
      HIGH_PRESSURE_BOARD_PAGE_COUNT + 1,
    );
    await page.waitForTimeout(100);

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
    const metrics: BoardTransferPerformanceMetrics = {
      fixturePreparationMs: performance.now() - fixturePreparationStartedAt,
      boardInitialRenderMs,
      transferCommitMs: transferCommittedAt - transferStartedAt,
      transferToCardMs: cardVisibleAt - transferCommittedAt,
      endToEndMs: cardVisibleAt - transferStartedAt,
      sourceBlockCount: expectedSourceBlockCount,
      movedChildBlockCount: HIGH_PRESSURE_CHILD_BLOCK_COUNT,
      initialBoardPageCount: HIGH_PRESSURE_BOARD_PAGE_COUNT,
      finalBoardPageCount: HIGH_PRESSURE_BOARD_PAGE_COUNT + 1,
      initialRenderedBoardCardCount: HIGH_PRESSURE_BOARD_PAGE_COUNT,
      finalRenderedBoardCardCount: HIGH_PRESSURE_BOARD_PAGE_COUNT,
      initialDomNodes,
      ...rendererMetrics,
    };
    const metricsPath = testInfo.outputPath("board-transfer-high-pressure-metrics.json");
    fs.writeFileSync(metricsPath, `${JSON.stringify(metrics, null, 2)}\n`);
    await testInfo.attach("board-transfer-high-pressure-metrics", {
      path: metricsPath,
      contentType: "application/json",
    });
    console.info(`[board-transfer-high-pressure] ${JSON.stringify(metrics)}`);

    expect(metrics.initialBoardPageCount).toBe(HIGH_PRESSURE_BOARD_PAGE_COUNT);
    expect(metrics.finalBoardPageCount).toBe(HIGH_PRESSURE_BOARD_PAGE_COUNT + 1);
    expect(metrics.initialRenderedBoardCardCount).toBe(HIGH_PRESSURE_BOARD_PAGE_COUNT);
    expect(metrics.finalRenderedBoardCardCount).toBe(HIGH_PRESSURE_BOARD_PAGE_COUNT);
    if (process.env.NODEX_SKIP_PERFORMANCE_GATES !== "1") {
      expect(metrics.transferCommitMs).toBeLessThan(5_000);
      expect(metrics.transferToCardMs).toBeLessThan(5_000);
    }
  } finally {
    if (application) await stopApplication(application);
    await shutdownTemporaryCore(nodexHome);
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
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
