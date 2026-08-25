import { describe, expect, test } from "vite-plus/test";

import { clearManagedAssetDisplayUrlCache, resolveAssetSourceToDisplayUrl } from "./assets";
import { getAssetSource } from "../../shared/assets";

describe("assets helpers", () => {
  test("maps a canonical managed locator through its absolute path to app://fs", () => {
    const source = getAssetSource("abc.png");

    expect(resolveAssetSourceToDisplayUrl(source, () => "/profile/assets/abc.png")).toBe(
      "app://fs/@fs/profile/assets/abc.png",
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

  test("caches only successful managed path resolutions for the renderer lifetime", () => {
    clearManagedAssetDisplayUrlCache();
    const source = getAssetSource("cached.png");
    let calls = 0;
    const resolver = () => {
      calls += 1;
      return calls === 1 ? null : "/profile/assets/cached.png";
    };

    expect(resolveAssetSourceToDisplayUrl(source, resolver)).toBe(null);
    expect(resolveAssetSourceToDisplayUrl(source, resolver)).toBe(
      "app://fs/@fs/profile/assets/cached.png",
    );
    expect(resolveAssetSourceToDisplayUrl(source, resolver)).toBe(
      "app://fs/@fs/profile/assets/cached.png",
    );
    expect(calls).toBe(2);
  });

  test("does not encode an invalid preload result as a relative app path", () => {
    clearManagedAssetDisplayUrlCache();
    expect(
      resolveAssetSourceToDisplayUrl(getAssetSource("relative.png"), () => "relative.png"),
    ).toBe(null);
  });
});
