import { describe, expect, test } from "vitest";
import { resolveExternalImageSource } from "./image-block";

describe("image block external source resolution", () => {
  test("rewrites canonical nodex asset URI to the private display protocol", () => {
    const resolved = resolveExternalImageSource("nodex://assets/plan.png");
    expect(resolved).toBe("nodex-asset://managed/plan.png");
  });

  test("keeps standard URLs unchanged", () => {
    const source = "https://example.com/plan.png";
    expect(resolveExternalImageSource(source)).toBe(source);
  });
});
