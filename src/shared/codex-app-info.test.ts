import { describe, expect, test } from "vitest";
import type { ProtocolAppInfo } from "./types";
import { normalizeCodexAppInfoLogos } from "./codex-app-info";

function app(overrides: Partial<ProtocolAppInfo> = {}): ProtocolAppInfo {
  return {
    id: "connector_docs",
    name: "Docs",
    description: null,
    logoUrl: null,
    logoUrlDark: null,
    iconAssets: null,
    iconDarkAssets: null,
    distributionChannel: null,
    branding: null,
    appMetadata: null,
    labels: null,
    installUrl: null,
    isAccessible: true,
    isEnabled: true,
    pluginDisplayNames: [],
    ...overrides,
  };
}

describe("normalizeCodexAppInfoLogos", () => {
  test("uses exact square-asset and light/dark fallback precedence", () => {
    const [normalized] = normalizeCodexAppInfoLogos([app({
      logoUrl: "fallback-light.png",
      logoUrlDark: "fallback-dark.png",
      iconAssets: { "256_square": "asset-light.png" },
      iconDarkAssets: { "256_square": "asset-dark.png" },
    })]);
    expect(normalized?.logoUrl).toBe("asset-light.png");
    expect(normalized?.logoUrlDark).toBe("asset-dark.png");

    const [darkOnly] = normalizeCodexAppInfoLogos([app({
      logoUrl: null,
      logoUrlDark: "fallback-dark.png",
      iconAssets: null,
      iconDarkAssets: { "256_square": "asset-dark.png" },
    })]);
    expect(darkOnly?.logoUrl).toBe("asset-dark.png");
    expect(darkOnly?.logoUrlDark).toBe("asset-dark.png");
  });

  test("trims logo URLs and resolves leading-slash assets against installUrl", () => {
    const [normalized] = normalizeCodexAppInfoLogos([app({
      installUrl: " https://apps.example.test/connectors/docs/install ",
      iconAssets: { "256_square": " /assets/docs.png " },
      iconDarkAssets: { "256_square": " /assets/docs-dark.png " },
    })]);
    expect(normalized?.logoUrl).toBe("https://apps.example.test/assets/docs.png");
    expect(normalized?.logoUrlDark).toBe("https://apps.example.test/assets/docs-dark.png");
  });

  test("preserves invalid relative paths and input identity when unchanged", () => {
    const unchanged = app({ logoUrl: "https://example.test/docs.png" });
    const same = normalizeCodexAppInfoLogos([unchanged]);
    expect(same[0]).toBe(unchanged);

    const invalid = app({ logoUrl: "/docs.png", installUrl: "not a url" });
    const normalized = normalizeCodexAppInfoLogos([invalid]);
    expect(normalized[0]?.logoUrl).toBe("/docs.png");
    expect(normalized[0]).toBe(invalid);
  });
});
