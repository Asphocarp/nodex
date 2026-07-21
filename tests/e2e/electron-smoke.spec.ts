import { expect, test } from "@playwright/test";
import { _electron as electron, type ElectronApplication } from "playwright";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const repositoryRoot = process.cwd();

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
  fs.writeFileSync(path.join(runtimeRoot, "runtime.json"), JSON.stringify({
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
      NODE_ENV: "test",
    },
  });
}

async function stopApplication(application: ElectronApplication): Promise<void> {
  const child = application.process();
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  await application.evaluate(({ app }) => app.exit(0)).catch(() => undefined);
  await Promise.race([
    exited,
    new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

test("persists a project across a full Electron restart", async () => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-electron-e2e-"));
  const nodexHome = path.join(fixtureRoot, "profile");
  const workspace = path.join(fixtureRoot, "workspace");
  fs.mkdirSync(workspace, { recursive: true });
  prepareRuntimeFixture(fixtureRoot);

  let application: ElectronApplication | undefined;
  try {
    application = await launchApplication(fixtureRoot, nodexHome);
    const firstWindow = await application.firstWindow();
    await firstWindow.evaluate(() => window.api?.awaitInitialization?.());

    const created = await firstWindow.evaluate(async ({ name, source }) => {
      return window.api?.invoke("projects:create", { name, sources: [source] });
    }, { name: "Electron persistence smoke", source: workspace });
    expect(created).toMatchObject({ name: "Electron persistence smoke" });

    const firstRead = await firstWindow.evaluate(async () => {
      return window.api?.invoke("projects:list");
    });
    expect(firstRead).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "Electron persistence smoke" }),
    ]));

    await stopApplication(application);
    application = undefined;
    application = await launchApplication(fixtureRoot, nodexHome);
    const restartedWindow = await application.firstWindow();
    await restartedWindow.evaluate(() => window.api?.awaitInitialization?.());

    const persisted = await restartedWindow.evaluate(async () => {
      return window.api?.invoke("projects:list");
    });
    expect(persisted).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "Electron persistence smoke" }),
    ]));
  } finally {
    if (application) await stopApplication(application);
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});
