import { describe, expect, test } from "bun:test";

import {
  extractAllDeclarations,
  findMatches,
  flattenCssNodes,
  mergeDeclarationMaps,
  parseCssNodes,
} from "./codex-css-extract";

describe("sync-codex-theme-utilities", () => {
  test("merges duplicate utility selectors and keeps nested support overrides separate", () => {
    const css = `
      .duration-relaxed {
        --tw-duration: var(--transition-duration-relaxed);
      }

      .duration-relaxed {
        transition-duration: var(--transition-duration-relaxed);
      }

      .\\[\\&_\\*\\]\\:text-token-foreground\\/50 * {
        color: var(--color-token-foreground);
      }

      @supports (color: color-mix(in lab, red, red)) {
        .\\[\\&_\\*\\]\\:text-token-foreground\\/50 * {
          color: color-mix(in oklab, var(--color-token-foreground) 50%, transparent);
        }
      }
    `;

    const matches = flattenCssNodes(parseCssNodes(css));

    const mergedDuration = mergeDeclarationMaps(
      findMatches(matches, ".duration-relaxed").map((match) =>
        extractAllDeclarations(match.body),
      ),
    );
    const baseForeground = mergeDeclarationMaps(
      findMatches(matches, ".\\[\\&_\\*\\]\\:text-token-foreground\\/50 *").map((match) =>
        extractAllDeclarations(match.body),
      ),
    );
    const supportedForeground = mergeDeclarationMaps(
      findMatches(matches, ".\\[\\&_\\*\\]\\:text-token-foreground\\/50 *", [
        "@supports (color: color-mix(in lab, red, red))",
      ]).map((match) => extractAllDeclarations(match.body)),
    );

    expect(mergedDuration.get("--tw-duration")).toBe(
      "var(--transition-duration-relaxed)",
    );
    expect(mergedDuration.get("transition-duration")).toBe(
      "var(--transition-duration-relaxed)",
    );
    expect(baseForeground.get("color")).toBe("var(--color-token-foreground)");
    expect(supportedForeground.get("color")).toBe(
      "color-mix(in oklab, var(--color-token-foreground) 50%, transparent)",
    );
  });

  test("finds codex-owned utility selectors that should not stay in local utilities", () => {
    const css = `
      @layer utilities {
        .scrollbar-stable {
          scrollbar-gutter: stable;
        }

        .disambiguated-digits {
          font-feature-settings:
            "cv01" on,
            "cv02" on;
        }

        .disambig-digits.slashed-zero {
          font-feature-settings: "ss06" on;
        }
      }
    `;

    const matches = flattenCssNodes(parseCssNodes(css));

    expect(findMatches(matches, ".scrollbar-stable", ["@layer utilities"]).length).toBe(1);
    expect(findMatches(matches, ".disambiguated-digits", ["@layer utilities"]).length).toBe(
      1,
    );
    expect(
      findMatches(matches, ".disambig-digits.slashed-zero", ["@layer utilities"]).length,
    ).toBe(1);
  });
});
