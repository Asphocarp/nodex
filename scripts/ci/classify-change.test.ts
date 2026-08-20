import { describe, expect, test } from "vitest";
import { classifyChangedPaths } from "./classify-change";

describe("CI change classification", () => {
  test("keeps documentation and landing changes out of expensive application jobs", () => {
    expect(classifyChangedPaths(["docs/release-macos.md", "docs/ARCHITECTURE.md"])).toEqual({
      app: false,
      dependencyKind: "none",
      browser: false,
      docsOnly: true,
      electronMain: false,
      fullRequired: false,
      landingOnly: false,
      migration: false,
      protocol: false,
      releaseMetadata: false,
      renderer: false,
      runtime: false,
      rust: false,
      storage: false,
      stressRelevant: false,
    });
    expect(classifyChangedPaths(["packages/landing/src/App.tsx"])).toEqual({
      app: false,
      dependencyKind: "none",
      browser: false,
      docsOnly: false,
      electronMain: false,
      fullRequired: false,
      landingOnly: true,
      migration: false,
      protocol: false,
      releaseMetadata: false,
      renderer: false,
      runtime: false,
      rust: false,
      storage: false,
      stressRelevant: false,
    });
  });

  test("routes an exact release metadata set to the narrow release guard", () => {
    expect(classifyChangedPaths([
      "Cargo.lock",
      "Cargo.toml",
      "CHANGELOG.md",
      "package.json",
    ])).toEqual({
      app: false,
      dependencyKind: "none",
      browser: false,
      docsOnly: false,
      electronMain: false,
      fullRequired: false,
      landingOnly: false,
      migration: false,
      protocol: false,
      releaseMetadata: true,
      renderer: false,
      runtime: false,
      rust: false,
      storage: false,
      stressRelevant: false,
    });
  });

  test("keeps an incomplete release metadata set on the ordinary gates", () => {
    expect(classifyChangedPaths(["package.json"])).toMatchObject({
      app: true,
      fullRequired: true,
      releaseMetadata: false,
      runtime: true,
    });
    expect(classifyChangedPaths([
      "Cargo.lock",
      "Cargo.toml",
      "CHANGELOG.md",
      "package.json",
      "README.md",
    ])).toMatchObject({
      app: true,
      fullRequired: true,
      releaseMetadata: false,
      runtime: true,
    });
  });

  test("distinguishes ordinary renderer work from runtime contract changes", () => {
    expect(classifyChangedPaths(["src/renderer/components/app.tsx"])).toMatchObject({
      app: true,
      browser: true,
      renderer: true,
      runtime: false,
      rust: false,
      stressRelevant: false,
    });
    expect(classifyChangedPaths(["resources/agent-runtime/openinterpreter.lock.json"])).toMatchObject({
      app: true,
      fullRequired: false,
      runtime: true,
    });
    expect(classifyChangedPaths(["scripts/release/bundle.ts"])).toMatchObject({
      app: true,
      fullRequired: false,
      runtime: true,
    });
  });

  test("selects deeper contracts for storage, protocol, and desktop changes", () => {
    expect(classifyChangedPaths(["crates/nodex-core/src/infrastructure/migration.rs"])).toMatchObject({
      migration: true,
      protocol: false,
      rust: true,
      storage: true,
      stressRelevant: true,
    });
    expect(classifyChangedPaths(["src/main/core-client/core-client.ts"])).toMatchObject({
      electronMain: true,
      protocol: true,
      runtime: true,
      stressRelevant: true,
    });
    expect(classifyChangedPaths(["scripts/build-resources.ts"])).toMatchObject({
      migration: false,
      runtime: true,
      storage: false,
    });
  });

  test("runs stress gates when their shared runtime or selection changes", () => {
    for (const path of [
      "vitest.main.config.ts",
      "config/vitest-test-tier.ts",
      "config/electron-test-runtime.ts",
      "scripts/run-vitest-in-electron.mjs",
    ]) {
      expect(classifyChangedPaths([path]), path).toMatchObject({
        app: true,
        stressRelevant: true,
      });
    }
  });

  test("keeps mixed renderer and Rust changes broad without forcing release gates", () => {
    expect(classifyChangedPaths([
      "src/renderer/components/app.tsx",
      "crates/nodex-core/src/database/relation_projection.rs",
    ])).toMatchObject({
      app: true,
      browser: true,
      electronMain: false,
      fullRequired: false,
      renderer: true,
      rust: true,
      stressRelevant: true,
    });
  });

  test("identifies dependency-only scopes without weakening the current gates", () => {
    expect(classifyChangedPaths([".github/workflows/ci.yml"]).dependencyKind)
      .toBe("github-actions");
    expect(classifyChangedPaths([".github/actions/setup-rust-ci/action.yml"]).dependencyKind)
      .toBe("github-actions");
    expect(classifyChangedPaths(["Cargo.lock", "crates/nodex-core/Cargo.toml"]).dependencyKind)
      .toBe("rust");
    expect(classifyChangedPaths(["package.json", "pnpm-lock.yaml"]).dependencyKind)
      .toBe("javascript");
    expect(classifyChangedPaths([
      "third_party/blocknote/packages/core/package.json",
      "pnpm-lock.yaml",
    ]).dependencyKind).toBe("editor");
  });

  test("chooses the stronger gate for unknown, empty, and explicit full inputs", () => {
    expect(classifyChangedPaths(["novel-build-input.xyz"])).toMatchObject({
      app: true,
      fullRequired: true,
      runtime: true,
    });
    expect(classifyChangedPaths([])).toMatchObject({ app: true, fullRequired: true, runtime: true });
    expect(classifyChangedPaths(["README.md"], { full: true })).toMatchObject({
      app: true,
      fullRequired: true,
      runtime: true,
    });
  });

  test("treats CI policy files as broad changes", () => {
    expect(classifyChangedPaths([".github/workflows/ci.yml"])).toMatchObject({
      fullRequired: true,
      runtime: true,
    });
  });

  test("rejects paths that escape the repository", () => {
    expect(() => classifyChangedPaths(["../outside"])).toThrow("invalid");
  });
});
