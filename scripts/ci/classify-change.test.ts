import { describe, expect, test } from "vitest";

import { APP_TEST_SUITES, STATIC_GROUPS } from "./ci-gate-plan";
import { classifyChangedPaths } from "./classify-change";

describe("CI change classification", () => {
  test("keeps documentation out of every expensive gate", () => {
    expect(classifyChangedPaths(["docs/release-macos.md", "docs/ARCHITECTURE.md"])).toEqual({
      allGates: false,
      appTestSuites: [],
      browser: false,
      dependencyKind: "none",
      docsOnly: true,
      electronE2e: false,
      landingOnly: false,
      protocolContracts: false,
      releaseTransition: false,
      runtimeMac: false,
      rustFast: false,
      rustMigration: false,
      staticGroups: [],
      stress: false,
    });
  });

  test("selects only the landing owner for landing plus documentation", () => {
    expect(classifyChangedPaths(["packages/landing/src/App.tsx", "README.md"])).toMatchObject({
      appTestSuites: [],
      landingOnly: true,
      staticGroups: ["landing"],
    });
  });

  test("routes the exact release metadata set to the narrow transition guard", () => {
    expect(classifyChangedPaths(["Cargo.lock", "Cargo.toml", "CHANGELOG.md", "package.json"]))
      .toMatchObject({ releaseTransition: true, rustFast: false, staticGroups: [] });
  });

  test("routes ordinary renderer work to app, browser, and Electron without Rust", () => {
    expect(classifyChangedPaths(["src/renderer/components/app.tsx"])).toMatchObject({
      appTestSuites: APP_TEST_SUITES,
      browser: true,
      electronE2e: true,
      runtimeMac: false,
      rustFast: false,
      staticGroups: ["types", "ui-contracts"],
      stress: false,
    });
  });

  test("routes main, protocol, Rust, and migration ownership explicitly", () => {
    expect(classifyChangedPaths(["src/main/window.ts"])).toMatchObject({
      appTestSuites: APP_TEST_SUITES,
      electronE2e: true,
      runtimeMac: false,
      rustFast: false,
      staticGroups: ["types", "repository-contracts"],
    });
    expect(classifyChangedPaths(["src/main/core-client/core-client.ts"])).toMatchObject({
      protocolContracts: true,
      runtimeMac: true,
      rustFast: true,
      stress: true,
    });
    expect(classifyChangedPaths(["crates/nodex-core/src/database/relation_projection.rs"]))
      .toMatchObject({ rustFast: true, rustMigration: false, stress: true });
    expect(classifyChangedPaths(["crates/nodex-core/src/infrastructure/migration.rs"]))
      .toMatchObject({ rustFast: true, rustMigration: true, stress: true });
  });

  test("keeps generated-resource ownership separate from Store migration", () => {
    expect(classifyChangedPaths(["scripts/build-resources.ts"])).toMatchObject({
      rustMigration: false,
      runtimeMac: true,
      staticGroups: ["types", "generated"],
    });
  });

  test("selects stress when test infrastructure changes", () => {
    for (const path of [
      "vitest.main.config.ts",
      "config/vitest-test-tier.ts",
      "config/electron-test-runtime.ts",
      "scripts/run-vitest-in-electron.mjs",
    ]) {
      expect(classifyChangedPaths([path]), path).toMatchObject({ stress: true });
    }
  });

  test("runs ordinary gates, never exhaustive Rust, for dependency changes", () => {
    expect(classifyChangedPaths(["package.json", "pnpm-lock.yaml"])).toMatchObject({
      allGates: false,
      dependencyKind: "javascript",
      rustFast: true,
      rustMigration: true,
      staticGroups: STATIC_GROUPS,
    });
    expect(classifyChangedPaths(["Cargo.lock", "crates/nodex-core/Cargo.toml"]))
      .toMatchObject({
        dependencyKind: "rust",
        rustFast: true,
        rustMigration: true,
      });
    expect(classifyChangedPaths([
      "third_party/blocknote/packages/core/package.json",
      "pnpm-lock.yaml",
    ])).toMatchObject({ dependencyKind: "editor" });
  });

  test("routes each local action to its real consumers", () => {
    expect(classifyChangedPaths([
      ".github/actions/run-stress-tests/action.yml",
      ".github/actions/run-stress-tests/scripts/prepare.sh",
    ]))
      .toMatchObject({ browser: false, rustFast: false, stress: true });
    expect(classifyChangedPaths([".github/actions/setup-playwright/action.yml"]))
      .toMatchObject({ browser: true, electronE2e: true, rustFast: false, stress: true });
    expect(classifyChangedPaths([".github/actions/setup-rust-ci/action.yml"]))
      .toMatchObject({ protocolContracts: true, runtimeMac: true, rustFast: true });
    expect(classifyChangedPaths([
      ".github/actions/setup-playwright/action.yml",
      ".github/actions/setup-rust-ci/action.yml",
    ])).toMatchObject({ allGates: true });
  });

  test("selects every ordinary gate for orchestration, unknown, empty, and explicit full inputs", () => {
    for (const candidate of [
      classifyChangedPaths([".github/workflows/ci.yml"]),
      classifyChangedPaths(["scripts/ci/classify-change.ts"]),
      classifyChangedPaths(["novel-build-input.xyz"]),
      classifyChangedPaths([]),
      classifyChangedPaths(["README.md"], { full: true }),
    ]) {
      expect(candidate).toMatchObject({
        allGates: true,
        appTestSuites: APP_TEST_SUITES,
        browser: true,
        protocolContracts: true,
        rustFast: true,
        rustMigration: true,
        staticGroups: STATIC_GROUPS,
        stress: true,
      });
    }
  });

  test("rejects paths that escape the repository", () => {
    expect(() => classifyChangedPaths(["../outside"])).toThrow("invalid");
  });
});
