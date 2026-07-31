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
import { LARGE_CONTENT_FIXTURE_SIZES } from "../../src/main/performance/large-content-fixtures";
import { LIBRARY_MODULE_CONTRACT_VERSION } from "../../src/shared/library-module";

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
  fs.writeFileSync(path.join(runtimeRoot, "agent-runtime.json"), JSON.stringify({
    artifacts,
    codexCompatibilityVersion: "0.0.0-e2e",
    entrypoint: "bin/interpreter",
    layoutVersion: 2,
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
    sourceRelease: {
      archiveSha256: "0".repeat(64),
      assetName: "nodex-e2e-fixture.tar.gz",
      repository: "openinterpreter/openinterpreter",
      tag: "rust-v0.0.0-e2e",
    },
    targetArch: process.arch,
    targetPlatform: process.platform,
    targetTriple: `${process.arch}-${process.platform}`,
  }));
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

async function stopApplication(application: ElectronApplication): Promise<void> {
  const child = application.process();
  const closed = application.close();
  const closedGracefully = await Promise.race([
    closed.then(() => true),
    new Promise<false>((resolve) => setTimeout(() => resolve(false), 5_000)),
  ]);
  if (closedGracefully) return;

  if (child.exitCode === null) {
    child.kill("SIGKILL");
  }
  await closed;
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
              activeProjectId?: string | null;
              sessionId?: string;
            };
            sessionViewsBySessionId?: Record<string, {
              tabsById?: Record<string, {
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
      kind: "session",
      activeProjectId: createdProject?.id,
    });
    const starterSessionId = layout?.location?.sessionId;
    const starterView = starterSessionId
      ? layout?.sessionViewsBySessionId?.[starterSessionId]
      : undefined;
    const tabs = Object.values(starterView?.tabsById ?? {});
    expect(tabs.map((tab) => tab.kind)).toEqual(["db_view", "page_stage"]);
    expect(starterView?.panels?.right).toMatchObject({
      collapsed: false,
      size: { fullWidth: true },
    });
    const activeRightTabId = starterView?.panels?.right?.layout?.root
      ?.activeTabId;
    expect(
      activeRightTabId
        ? starterView?.tabsById?.[activeRightTabId]?.kind
        : undefined,
    ).toBe("page_stage");
    const starterPageId = tabs.find((tab) => tab.kind === "page_stage")
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
      kind: "session",
      activeProjectId: createdProject?.id,
    });
    await expect(restartedWindow.getByRole("heading", {
      name: "Select a project",
    })).toHaveCount(0);
  } finally {
    if (application) await stopApplication(application);
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("creates and draws in an inline Canvas without taking over the Page", async () => {
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
      name: "Canvas workflow",
      exact: true,
    }).click();
    await page
      .locator('[data-app-action-sidebar-thread-title="Database View"]')
      .first()
      .click();
    await page.waitForTimeout(1_000);
    await page.getByRole("button", { name: "Open Library" }).click({
      force: true,
    });
    await page.getByRole("button", { name: "New Library item" }).click({
      force: true,
    });
    await page.getByRole("menuitem", { name: "Page" }).click();
    await page.getByRole("button", { name: "Page actions" }).waitFor();

    await page.getByRole("button", { name: "Open Library" }).click({
      force: true,
    });
    await page
      .getByRole("button", { name: "Actions for Untitled" })
      .last()
      .click();
    await page.getByRole("menuitem", { name: "Open in Project…" }).click();
    await page.getByRole("button", { name: "Grant and open" }).click();
    await page.getByRole("button", { name: "Page actions" }).waitFor();

    const editor = page
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
        const raw = await window.api?.invoke("library-module:read", {
          version: contractVersion,
          read: { mode: "canvas_target", canvasId: targetCanvasId },
        }) as {
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
