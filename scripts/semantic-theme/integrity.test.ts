import { describe, expect, test } from "vitest";

import { collectSemanticThemeIntegrityDiagnostics } from "./integrity";

const options = {
  collisionResolutions: {},
  requiredVariables: [],
  runtimeProviders: [],
  checkedOwnerNames: new Set(["--radius-lg", "--a", "--b"]),
} as const;

const codesFor = (
  artifacts: readonly { readonly path: string; readonly content: string }[],
  providers: readonly { readonly path: string; readonly content: string }[] = [],
): readonly string[] => collectSemanticThemeIntegrityDiagnostics(
  artifacts,
  providers,
  options,
).map((item) => item.code);

describe("semantic theme integrity", () => {
  test("rejects a dependency whose provider does not cover every consumer scope", () => {
    expect(codesFor([{
      path: "generated.css",
      content: `
        :root { --radius-lg: calc(10px * var(--radius-scale)); }
        .electron-light { --radius-scale: 1.25; }
      `,
    }])).toContain("THEME_DEPENDENCY_SCOPE_UNRESOLVED");
  });

  test("rejects custom-property cycles in an effective target scope", () => {
    expect(codesFor([{
      path: "generated.css",
      content: ":root { --a: var(--b); --b: var(--a); }",
    }])).toContain("THEME_DEPENDENCY_CYCLE");
  });

  test("rejects conflicting root owners unless the profile resolves ownership", () => {
    expect(codesFor(
      [{ path: "generated.css", content: ":root { --shared: red; }" }],
      [{ path: "product.css", content: ":root { --shared: blue; }" }],
    )).toContain("THEME_COLLISION_UNOWNED");
  });

  test("accepts a complete non-cyclic dependency graph", () => {
    expect(codesFor([{
      path: "generated.css",
      content: ":root { --radius-scale: 1.25; --radius-lg: calc(10px * var(--radius-scale)); }",
    }])).toEqual([]);
  });

  test("walks required variables through transitive aliases", () => {
    const diagnostics = collectSemanticThemeIntegrityDiagnostics([{
      path: "generated.css",
      content: ":root { --surface: var(--host-surface); --host-surface: var(--missing-leaf); }",
    }], [], {
      ...options,
      requiredVariables: [{
        name: "--surface",
        targets: ["electron-light"],
      }],
      checkedOwnerNames: undefined,
    });

    expect(diagnostics.map((item) => item.code)).toContain("THEME_DEPENDENCY_SCOPE_UNRESOLVED");
    expect(diagnostics.some((item) => item.subject?.includes("--missing-leaf"))).toBe(true);
  });
});
