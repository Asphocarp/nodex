import { describe, expect, test } from "vitest";

import {
  createSemanticThemeProvenance,
  parseSemanticThemeProvenance,
  renderSemanticThemeProvenance,
} from "./provenance";

describe("semantic theme provenance", () => {
  test("is deterministic and accepts only the closed public schema", () => {
    const provenance = createSemanticThemeProvenance("ref-1", [
      { path: "z.css", content: "z" },
      { path: "a.css", content: "a" },
    ]);
    const rendered = renderSemanticThemeProvenance(provenance);

    expect(parseSemanticThemeProvenance(rendered)).toEqual(provenance);
    expect(provenance.artifacts.map((artifact) => artifact.path)).toEqual(["a.css", "z.css"]);
    expect(() => parseSemanticThemeProvenance(JSON.stringify({
      ...provenance,
      sourcePath: "/private/reference.css",
    }))).toThrow("THEME_PROVENANCE_INVALID");
  });
});
