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
  readonly afterPack?: string;
  readonly dmg?: {
    readonly sign?: boolean;
    readonly writeUpdateInfo?: boolean;
  };
  readonly extraFiles?: readonly ElectronBuilderFileSet[];
  readonly extraResources?: readonly ElectronBuilderFileSet[];
  readonly mac?: {
    readonly binaries?: readonly string[];
    readonly extendInfo?: Record<string, unknown>;
    readonly target?: readonly string[];
  };
  readonly publish?: unknown;
}

describe("electron-builder runtime resources", () => {
  test("mounts the exact Agent runtime and Skill artifacts at Resources", () => {
    const configPath = path.resolve("electron-builder.yml");
    const config = load(fs.readFileSync(configPath, "utf8")) as ElectronBuilderConfig;

    expect(config.afterPack).toBe("scripts/restore-packaged-runtime-closure.mjs");
    expect(config.extraResources).toContainEqual({
      from: ".generated/codex-runtime/agent-runtime",
      to: ".",
      filter: ["**/*"],
    });
    expect(config.extraResources).toContainEqual({
      from: ".generated/official-agent-skills",
      to: "agent-skills",
      filter: ["**/*"],
    });
    expect(config.extraResources).toContainEqual({
      from: ".generated/sparkle-runtime/${arch}/nodex-sparkle.node",
      to: "native/nodex-sparkle.node",
    });
    expect(config.extraResources).toEqual(expect.arrayContaining([
      { from: ".generated/build-resources/legacy-profile-migrator.mjs", to: "legacy-profile-migrator.mjs" },
      { from: ".generated/build-resources/legacy-profile-migrator.mjs.LEGAL.txt", to: "legacy-profile-migrator.mjs.LEGAL.txt" },
      { from: ".generated/build-resources/legacy-profile-migrator.json", to: "legacy-profile-migrator.json" },
      { from: ".generated/build-resources/THIRD_PARTY_NOTICES.txt", to: "THIRD_PARTY_NOTICES.txt" },
    ]));
    expect(config.extraFiles).toContainEqual({
      from: ".generated/sparkle-runtime/${arch}/Sparkle.framework",
      to: "Frameworks/Sparkle.framework",
      filter: ["**/*"],
    });
    expect(config.mac?.binaries).toContain("Contents/Resources/codex-path/rg");
    expect(config.mac?.binaries).not.toContain("Contents/Resources/bin/rg");
    expect(config.mac?.binaries?.some((entry) => (
      entry.startsWith("Contents/Resources/agent-runtime/")
    ))).toBe(false);
    expect(config.mac?.target).toEqual(["dmg"]);
    expect(config.mac?.extendInfo).toMatchObject({
      SUPublicEDKey: "YNySLZ74gjVAOpEdMo9OOEPvuTEMZf8fMnI+oQD7Ifs=",
      SURequireSignedFeed: true,
      SUVerifyUpdateBeforeExtraction: true,
    });
    expect(config.dmg).toMatchObject({ sign: true, writeUpdateInfo: false });
    expect(config.publish).toBeUndefined();
  });
});
