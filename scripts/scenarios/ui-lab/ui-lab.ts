import { spawn, type ChildProcess } from "node:child_process";
import { readFile, realpath, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";

import { chromium, type Browser, type Page } from "playwright";

import {
  parseScenarioFacts,
  parseScenarioManifest,
  type ScenarioFacts,
  type ScenarioManifest,
} from "../contracts";
import { RendererIpcSeedAdapter } from "../adapters/renderer-ipc-seed-adapter";
import type { IsolatedProfile } from "../profile/isolated-profile";
import {
  cleanupIsolatedProfile,
  createIsolatedProfile,
  resumeIsolatedProfile,
} from "../profile/isolated-profile";
import { getScenario } from "../registry";
import { inspectScenario, materializeScenario } from "../seed/scenario-seed";
import { getScenarioUiProjection } from "../ui-registry";
import {
  createUiLabSessionStore,
  type UiLabScenarioSeedProvenance,
  type UiLabSessionRecord,
} from "./session-store";

const SESSION_MANIFEST_FILE = "ui-lab-session.json";
const MAX_LOG_CHARS = 32_768;

interface UiLabOwnedManifest {
  readonly version: 1;
  readonly sessionId: string;
  readonly profileRunId: string;
  readonly repositoryRealpath: string;
  readonly createdAt: string;
  readonly seed: UiLabScenarioSeedProvenance;
  readonly scenario: ScenarioManifest;
  readonly initialFacts: ScenarioFacts;
}

export interface UiLabSession {
  readonly sessionId: string;
  readonly child: ChildProcess;
  readonly profile: IsolatedProfile;
  readonly page: Page;
  readonly seed: UiLabScenarioSeedProvenance;
  readonly exit: Promise<number>;
  stop(): Promise<void>;
}

export type OpenUiLabInput = {
  readonly appMode: "prepared" | "dev";
  readonly target:
    | { readonly kind: "seed"; readonly scenarioId: string }
    | { readonly kind: "resume"; readonly sessionId: string };
};

const parseOwnedManifest = (value: unknown): UiLabOwnedManifest => {
  const candidate = value as Partial<UiLabOwnedManifest>;
  if (
    typeof value !== "object"
    || value === null
    || candidate.version !== 1
    || typeof candidate.sessionId !== "string"
    || typeof candidate.profileRunId !== "string"
    || typeof candidate.repositoryRealpath !== "string"
    || typeof candidate.createdAt !== "string"
    || typeof candidate.seed !== "object"
    || candidate.seed === null
    || candidate.seed.kind !== "scenario"
    || typeof candidate.seed.scenarioId !== "string"
    || typeof candidate.seed.scenarioRevision !== "number"
    || !candidate.scenario
    || !candidate.initialFacts
  ) {
    throw new Error("Retained UI Lab session manifest is invalid");
  }
  return {
    version: 1,
    sessionId: candidate.sessionId,
    profileRunId: candidate.profileRunId,
    repositoryRealpath: candidate.repositoryRealpath,
    createdAt: candidate.createdAt,
    seed: candidate.seed,
    scenario: parseScenarioManifest(candidate.scenario),
    initialFacts: parseScenarioFacts(candidate.initialFacts),
  };
};

const matchesRecord = (
  manifest: UiLabOwnedManifest,
  record: UiLabSessionRecord,
  profile: IsolatedProfile,
): boolean =>
  manifest.sessionId === record.sessionId
  && manifest.profileRunId === profile.runId
  && manifest.repositoryRealpath === profile.repositoryRealpath
  && manifest.seed.scenarioId === record.seed.scenarioId
  && manifest.seed.scenarioRevision === record.seed.scenarioRevision;

const waitForCdpEndpoint = (
  child: ChildProcess,
  port: number,
): Promise<{ readonly endpoint: string }> => {
  let buffered = "";
  const append = (chunk: Buffer | string) => {
    const text = String(chunk);
    buffered = `${buffered}${text}`.slice(-MAX_LOG_CHARS);
  };
  child.stdout?.on("data", append);
  child.stderr?.on("data", append);
  return new Promise((resolve, reject) => {
    child.once("error", (error) => reject(error));
    const deadline = Date.now() + 300_000;
    const poll = async (): Promise<void> => {
      if (child.exitCode !== null || child.signalCode !== null) {
        reject(new Error(
          `UI Lab process exited before CDP was ready (code ${String(child.exitCode)}, signal ${String(child.signalCode)})\n${buffered}`,
        ));
        return;
      }
      try {
        const response = await fetch(`http://127.0.0.1:${port}/json/version`);
        const value = await response.json() as { webSocketDebuggerUrl?: unknown };
        if (typeof value.webSocketDebuggerUrl === "string") {
          resolve({ endpoint: value.webSocketDebuggerUrl });
          return;
        }
      } catch {
        // Electron has not bound the reserved loopback port yet.
      }
      if (Date.now() >= deadline) {
        reject(new Error(`Timed out waiting for Electron CDP endpoint\n${buffered}`));
        return;
      }
      setTimeout(() => void poll(), 100);
    };
    void poll();
  });
};

const reserveLoopbackPort = async (): Promise<number> =>
  await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Failed to reserve a loopback CDP port"));
        return;
      }
      server.close((error) => {
        if (error) reject(error);
        else resolve(address.port);
      });
    });
  });

const findNodexPage = async (browser: Browser): Promise<Page> => {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    for (const context of browser.contexts()) {
      for (const page of context.pages()) {
        const capable = await page.evaluate(() => {
          const api = (window as unknown as {
            api?: { invoke?: unknown; awaitInitialization?: unknown };
          }).api;
          return typeof api?.invoke === "function"
            && typeof api.awaitInitialization === "function";
        }).catch(() => false);
        if (!capable) continue;
        await page.evaluate(async () => {
          const api = (window as unknown as {
            api: { awaitInitialization(): Promise<void> };
          }).api;
          await api.awaitInitialization();
        });
        return page;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("CDP connected, but no initialized Nodex renderer appeared");
};

const stopChild = async (child: ChildProcess): Promise<void> => {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  const waitForExit = async (timeoutMs: number): Promise<boolean> =>
    await Promise.race([
      exited.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), timeoutMs)),
    ]);
  const signal = (targetSignal: NodeJS.Signals): void => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    if (child.pid === undefined) return;
    try {
      process.kill(process.platform === "win32" ? child.pid : -child.pid, targetSignal);
    } catch {
      child.kill(targetSignal);
    }
  };
  signal("SIGTERM");
  if (await waitForExit(20_000)) return;
  signal("SIGKILL");
  if (await waitForExit(5_000)) return;
  throw new Error("UI Lab process group did not exit after bounded termination");
};

export const openUiLab = async (input: OpenUiLabInput): Promise<UiLabSession> => {
  const repositoryRealpath = await realpath(process.cwd());
  const sessionStore = createUiLabSessionStore(repositoryRealpath);
  let profile: IsolatedProfile;
  let ownedManifest: UiLabOwnedManifest | null = null;
  if (input.target.kind === "seed") {
    getScenario(input.target.scenarioId);
    getScenarioUiProjection(input.target.scenarioId);
    profile = await createIsolatedProfile({
      label: `ui-${input.target.scenarioId}`,
      codex: "empty",
      retention: "keep",
    });
  } else {
    const retained = await sessionStore.find(input.target.sessionId);
    if (!retained) {
      throw new Error(`No retained UI Lab session: ${input.target.sessionId}`);
    }
    profile = await resumeIsolatedProfile(retained.runRoot);
    ownedManifest = parseOwnedManifest(JSON.parse(await readFile(
      path.join(profile.runRoot, SESSION_MANIFEST_FILE),
      "utf8",
    )));
    if (!matchesRecord(ownedManifest, retained, profile)) {
      throw new Error("Retained UI Lab session identity does not match its Profile");
    }
  }

  let child: ChildProcess | null = null;
  let browser: Browser | null = null;
  try {
    const args = ["scripts/run.sh", "--keep", "--root", profile.runRoot];
    if (input.appMode === "dev") args.push("--dev");
    const cdpPort = await reserveLoopbackPort();
    child = spawn("bash", args, {
      cwd: process.cwd(),
      detached: process.platform !== "win32",
      env: { ...process.env, NODEX_REMOTE_DEBUGGING_PORT: String(cdpPort) },
      stdio: ["inherit", "pipe", "pipe"],
    });
    const runningChild = child;
    const exit = new Promise<number>((resolve) => {
      runningChild.once("exit", (code) => resolve(code ?? 1));
    });
    const cdp = await waitForCdpEndpoint(runningChild, cdpPort);
    browser = await chromium.connectOverCDP(cdp.endpoint, { timeout: 120_000 });
    const page = await findNodexPage(browser);
    if (input.target.kind === "seed") {
      const recipe = getScenario(input.target.scenarioId);
      const uiProjection = getScenarioUiProjection(input.target.scenarioId);
      const seedAdapter = new RendererIpcSeedAdapter(page);
      const scenario = await materializeScenario(
        input.target.scenarioId,
        seedAdapter,
        profile.initialProjectsDirectory,
      );
      const initialFacts = await inspectScenario(scenario, seedAdapter);
      await uiProjection.focus(page, scenario);
      await uiProjection.verify(page, initialFacts);
      ownedManifest = {
        version: 1,
        sessionId: profile.runId,
        profileRunId: profile.runId,
        repositoryRealpath,
        createdAt: new Date().toISOString(),
        seed: {
          kind: "scenario",
          scenarioId: recipe.id,
          scenarioRevision: recipe.revision,
        },
        scenario,
        initialFacts,
      };
      await writeFile(
        path.join(profile.runRoot, SESSION_MANIFEST_FILE),
        `${JSON.stringify(ownedManifest, null, 2)}\n`,
        {
          mode: 0o600,
          flag: "wx",
        },
      );
    }
    if (!ownedManifest) throw new Error("UI Lab session manifest is unavailable");
    await sessionStore.record({
      sessionId: ownedManifest.sessionId,
      runRoot: profile.runRoot,
      repositoryRealpath: profile.repositoryRealpath,
      seed: ownedManifest.seed,
      createdAt: ownedManifest.createdAt,
      updatedAt: new Date().toISOString(),
    });
    let stopPromise: Promise<void> | null = null;
    return {
      sessionId: ownedManifest.sessionId,
      child: runningChild,
      profile,
      page,
      seed: ownedManifest.seed,
      exit,
      stop: async () => {
        stopPromise ??= stopChild(runningChild).finally(async () => {
          await browser?.close().catch(() => undefined);
        });
        return await stopPromise;
      },
    };
  } catch (error) {
    await browser?.close().catch(() => undefined);
    if (child) {
      try {
        await stopChild(child);
      } catch (stopError) {
        throw new AggregateError(
          [error, stopError],
          `UI Lab failed and could not stop ${profile.runRoot}`,
        );
      }
    }
    if (input.target.kind === "seed") {
      const cleanup = await cleanupIsolatedProfile({
        ...profile,
        retention: "dispose",
      });
      if (cleanup.status === "unsafe") {
        throw new AggregateError(
          [error, new Error(cleanup.reason)],
          `UI Lab failed and preserved unsafe Profile ${profile.runRoot}`,
        );
      }
    }
    throw error;
  }
};
