import { describe, expect, test } from "vite-plus/test";
import {
  packageSupportsTargetOs,
  renderThirdPartyNotices,
  type ThirdPartyLegalEntry,
} from "./generate-third-party-notices";

function entry(overrides: Partial<ThirdPartyLegalEntry>): ThirdPartyLegalEntry {
  return {
    homepage: null,
    identity: "example@1.0.0",
    legalText: "Example license text",
    license: "MIT",
    ...overrides,
  };
}

describe("third-party notice generation", () => {
  test("keeps platform-neutral and macOS packages while excluding other binaries", () => {
    expect(packageSupportsTargetOs(undefined, "darwin")).toBe(true);
    expect(packageSupportsTargetOs(["darwin"], "darwin")).toBe(true);
    expect(packageSupportsTargetOs(["linux"], "darwin")).toBe(false);
    expect(packageSupportsTargetOs(["!win32"], "darwin")).toBe(true);
    expect(packageSupportsTargetOs(["!darwin"], "darwin")).toBe(false);
  });

  test("sorts packages and emits a shared legal text only once", () => {
    const output = renderThirdPartyNotices([
      entry({ identity: "zeta@1.0.0" }),
      entry({ identity: "alpha@2.0.0", homepage: "https://example.com/alpha" }),
    ]);

    expect(output.indexOf("alpha@2.0.0")).toBeLessThan(output.indexOf("zeta@1.0.0"));
    expect(output.match(/Example license text/g)).toHaveLength(1);
    expect(output).toContain("alpha@2.0.0 — MIT — https://example.com/alpha");
  });

  test("keeps declared-license evidence when a package omits its license file", () => {
    const output = renderThirdPartyNotices([
      entry({ identity: "metadata-only@1.0.0", legalText: null, license: "ISC" }),
    ]);

    expect(output).toContain("metadata-only@1.0.0 — ISC");
    expect(output).toContain("No separate license or notice file was published");
  });
});
