import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { parse as parseToml } from "smol-toml";
import { CODEX_FEATURE_DEFAULTS, materializeCodexFeatureDefaults } from "./codex-feature-defaults";

const temporaryHomes: string[] = [];

async function createTemporaryHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "nodex-codex-feature-defaults-"));
  temporaryHomes.push(home);
  return home;
}

afterEach(async () => {
  await Promise.all(
    temporaryHomes.splice(0).map(async (home) => {
      await rm(home, { recursive: true, force: true });
    }),
  );
});

describe("Codex feature defaults", () => {
  test("creates a fresh Agent config with every supported default", async () => {
    const home = await createTemporaryHome();

    const result = await materializeCodexFeatureDefaults(home);
    const parsed = parseToml(await readFile(result.configPath, "utf8"));

    expect(result).toMatchObject({
      added: Object.keys(CODEX_FEATURE_DEFAULTS),
      changed: true,
    });
    expect(parsed).toEqual({ features: CODEX_FEATURE_DEFAULTS });
  });

  test("preserves explicit feature values and unrelated config", async () => {
    const home = await createTemporaryHome();
    const configPath = join(home, "config.toml");
    await writeFile(
      configPath,
      [
        'model = "gpt-test"',
        "integer_setting = 1",
        "float_setting = 1.0",
        "",
        "[features]",
        "unified_exec = false",
        "prevent_idle_sleep = false",
        "custom_feature = false",
        "",
      ].join("\n"),
    );

    const firstResult = await materializeCodexFeatureDefaults(home);
    const firstContents = await readFile(configPath, "utf8");
    const parsed = parseToml(firstContents, { integersAsBigInt: true });
    const secondResult = await materializeCodexFeatureDefaults(home);

    expect(firstResult.added).toEqual(["shell_snapshot", "multi_agent", "respect_system_proxy"]);
    expect(parsed).toMatchObject({
      model: "gpt-test",
      integer_setting: 1n,
      float_setting: 1,
      features: {
        unified_exec: false,
        shell_snapshot: true,
        multi_agent: true,
        prevent_idle_sleep: false,
        respect_system_proxy: true,
        custom_feature: false,
      },
    });
    expect(secondResult).toMatchObject({ added: [], changed: false });
    expect(await readFile(configPath, "utf8")).toBe(firstContents);
  });

  test("does not overwrite an invalid features value", async () => {
    const home = await createTemporaryHome();
    const configPath = join(home, "config.toml");
    const source = 'features = "invalid"\n';
    await writeFile(configPath, source);

    await expect(materializeCodexFeatureDefaults(home)).rejects.toThrow(
      "Codex config [features] must be a TOML table",
    );
    expect(await readFile(configPath, "utf8")).toBe(source);
  });
});
