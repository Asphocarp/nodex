import { describe, expect, test } from "vitest";

import { resolveAssetSourceToDisplayUrl } from "./assets";
import { getAssetSource } from "../../shared/assets";

describe("assets helpers", () => {
  test("maps canonical managed asset URI to the private display protocol", () => {
    const source = getAssetSource("abc.png");

    expect(resolveAssetSourceToDisplayUrl(source)).toBe(
      "nodex-asset://managed/abc.png",
    );
  });

  test("passes through non-asset URLs", () => {
    const external = "https://example.com/image.png";
    expect(resolveAssetSourceToDisplayUrl(external)).toBe(external);
  });

  test("passes through invalid asset URIs", () => {
    const invalid = "nodex://assets/not/valid/path/extra";
    expect(resolveAssetSourceToDisplayUrl(invalid)).toBe(invalid);
  });
});
