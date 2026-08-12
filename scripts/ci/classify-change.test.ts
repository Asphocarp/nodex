import { describe, expect, test } from "vitest";
import { classifyChangedPaths } from "./classify-change";

describe("CI change classification", () => {
  test("keeps documentation and landing changes out of expensive application jobs", () => {
    expect(classifyChangedPaths(["docs/release-macos.md", "docs/ARCHITECTURE.md"])).toEqual({
      app: false,
      docsOnly: true,
      landingOnly: false,
      releaseMetadata: false,
      runtime: false,
    });
    expect(classifyChangedPaths(["packages/landing/src/App.tsx"])).toEqual({
      app: false,
      docsOnly: false,
      landingOnly: true,
      releaseMetadata: false,
      runtime: false,
    });
  });

  test("forces release metadata through both application and runtime gates", () => {
    expect(classifyChangedPaths([
      "Cargo.lock",
      "Cargo.toml",
      "CHANGELOG.md",
      "package.json",
    ])).toEqual({
      app: true,
      docsOnly: false,
      landingOnly: false,
      releaseMetadata: true,
      runtime: true,
    });
  });

  test("distinguishes ordinary renderer work from runtime contract changes", () => {
    expect(classifyChangedPaths(["src/renderer/components/app.tsx"]).runtime).toBe(false);
    expect(classifyChangedPaths(["resources/agent-runtime/openinterpreter.lock.json"]).runtime).toBe(true);
    expect(classifyChangedPaths(["scripts/release/bundle.ts"]).runtime).toBe(true);
  });

  test("chooses the stronger gate for unknown, empty, and explicit full inputs", () => {
    expect(classifyChangedPaths(["novel-build-input.xyz"])).toMatchObject({ app: true, runtime: true });
    expect(classifyChangedPaths([])).toMatchObject({ app: true, runtime: true });
    expect(classifyChangedPaths(["README.md"], { full: true })).toMatchObject({ app: true, runtime: true });
  });

  test("rejects paths that escape the repository", () => {
    expect(() => classifyChangedPaths(["../outside"])).toThrow("invalid");
  });
});
