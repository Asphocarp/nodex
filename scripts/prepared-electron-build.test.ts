import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  recordPreparedElectronBuild,
  verifyPreparedElectronBuild,
} from "./prepared-electron-build";

const temporaryRoots: string[] = [];

const makeFixture = (): {
  manifestPath: string;
  repositoryRoot: string;
} => {
  const repositoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-prepared-build-"));
  temporaryRoots.push(repositoryRoot);
  const requiredInputs = [
    "config/value.ts",
    "packages/codex-app-server-protocol/value.ts",
    "packages/core-protocol/value.ts",
    "resources/THIRD_PARTY_NOTICES.txt",
    "resources/icon.icon/value.json",
    "resources/icon.png",
    "resources/legacy-profile-migrator.json",
    "resources/legacy-profile-migrator.mjs",
    "resources/legacy-profile-migrator.mjs.LEGAL.txt",
    "resources/nodex-icon.svg",
    "resources/nodex-notification.aiff",
    "resources/third-party/open-interpreter/LICENSE",
    "resources/third-party/open-interpreter/NOTICE",
    "scripts/build-legacy-profile-migrator.ts",
    "scripts/generate-third-party-notices.ts",
    "scripts/legacy-profile-migrator/value.ts",
    "scripts/legacy-profile-migrator-artifacts.ts",
    "scripts/prepared-electron-build.ts",
    "scripts/sync-app-icons.ts",
    "src/value.ts",
    "third_party/blocknote/packages/value.ts",
    "crates/example/Cargo.toml",
    "crates/example/src/lib.rs",
    ".node-version",
    "Cargo.lock",
    "Cargo.toml",
    "electron-builder.yml",
    "electron.vite.config.ts",
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "rust-toolchain.toml",
    "tsconfig.json",
    "tsconfig.node.json",
    "tsconfig.web.json",
    "out/main/bootstrap.js",
    "out/preload/index.js",
    "out/renderer/index.html",
  ];
  for (const relativePath of requiredInputs) {
    const absolutePath = path.join(repositoryRoot, relativePath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, `${relativePath}\n`, "utf8");
  }
  fs.writeFileSync(
    path.join(repositoryRoot, "package.json"),
    `${JSON.stringify({ name: "nodex", version: "1.2.3" })}\n`,
    "utf8",
  );
  return {
    repositoryRoot,
    manifestPath: path.join(repositoryRoot, ".generated/prepared.json"),
  };
};

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("prepared Electron build", () => {
  test("reuses only the exact recorded inputs and output closure", () => {
    const fixture = makeFixture();
    const recorded = recordPreparedElectronBuild(fixture);

    expect(verifyPreparedElectronBuild(fixture).generationId).toBe(recorded.generationId);

    fs.appendFileSync(path.join(fixture.repositoryRoot, "src/value.ts"), "changed\n");
    expect(() => verifyPreparedElectronBuild(fixture)).toThrow("inputs are stale");
  });

  test("treats Rust and packaging sources as part of the build closure", () => {
    const fixture = makeFixture();
    recordPreparedElectronBuild(fixture);

    fs.appendFileSync(
      path.join(fixture.repositoryRoot, "crates/example/src/lib.rs"),
      "pub fn changed() {}\n",
    );
    expect(() => verifyPreparedElectronBuild(fixture)).toThrow("inputs are stale");

    recordPreparedElectronBuild(fixture);
    fs.appendFileSync(path.join(fixture.repositoryRoot, "electron-builder.yml"), "changed: true\n");
    expect(() => verifyPreparedElectronBuild(fixture)).toThrow("inputs are stale");
  });

  test("rejects damaged and additional build outputs", () => {
    const fixture = makeFixture();
    recordPreparedElectronBuild(fixture);
    fs.appendFileSync(path.join(fixture.repositoryRoot, "out/main/bootstrap.js"), "changed\n");

    expect(() => verifyPreparedElectronBuild(fixture)).toThrow("outputs are stale or damaged");

    recordPreparedElectronBuild(fixture);
    fs.writeFileSync(path.join(fixture.repositoryRoot, "out/main/extra.js"), "extra\n");
    expect(() => verifyPreparedElectronBuild(fixture)).toThrow("outputs are stale or damaged");
  });

  test("refuses to bind outputs to a different pre-build input digest", () => {
    const fixture = makeFixture();

    expect(() => recordPreparedElectronBuild(fixture, "0".repeat(64))).toThrow(
      "inputs changed while the production build was running",
    );
  });
});
