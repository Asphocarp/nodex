import fs from "node:fs";
import path from "node:path";

import { load } from "js-yaml";
import { describe, expect, test } from "vitest";

interface ElectronBuilderFileSet {
  readonly filter?: readonly string[];
  readonly from?: string;
  readonly to?: string;
}

interface ElectronBuilderConfig {
  readonly extraResources?: readonly ElectronBuilderFileSet[];
  readonly mac?: {
    readonly binaries?: readonly string[];
  };
}

describe("electron-builder runtime resources", () => {
  test("mounts the Agent package at Resources and signs one shared ripgrep", () => {
    const configPath = path.resolve("electron-builder.yml");
    const config = load(fs.readFileSync(configPath, "utf8")) as ElectronBuilderConfig;

    expect(config.extraResources).toContainEqual({
      from: ".generated/codex-runtime/agent-runtime",
      to: ".",
      filter: ["**/*"],
    });
    expect(config.mac?.binaries).toContain("Contents/Resources/codex-path/rg");
    expect(config.mac?.binaries).not.toContain("Contents/Resources/bin/rg");
    expect(config.mac?.binaries?.some((entry) => (
      entry.startsWith("Contents/Resources/agent-runtime/")
    ))).toBe(false);
  });
});
