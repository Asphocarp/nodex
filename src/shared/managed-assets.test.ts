import { describe, expect, test } from "vitest";
import { getAssetSource } from "./assets";
import {
  MAX_MANAGED_PREVIEW_BYTES,
  MAX_MANAGED_PREVIEW_LINES,
  createManagedTextPreview,
  getManagedAssetDisplayUrl,
} from "./managed-assets";

describe("managed assets", () => {
  test("maps a canonical asset source to the private display scheme", () => {
    expect(getManagedAssetDisplayUrl(getAssetSource("image.png"))).toBe(
      "nodex-asset://managed/image.png",
    );
  });

  test.each([
    "https://example.com/image.png",
    "data:image/png;base64,AA==",
    "blob:https://example.com/id",
    "nodex://assets/nested/image.png",
    "another-scheme://asset",
  ])("passes through non-managed or invalid sources: %s", (source) => {
    expect(getManagedAssetDisplayUrl(source)).toBe(source);
  });

  test("does not reinterpret encoded unsafe asset names", () => {
    const source = "nodex://assets/image%20one.png";
    expect(getManagedAssetDisplayUrl(source)).toBe(
      source,
    );
  });

  test("bounds text previews by line count", () => {
    const value = Array.from(
      { length: MAX_MANAGED_PREVIEW_LINES + 1 },
      (_, index) => `line-${index}`,
    ).join("\n");
    const preview = createManagedTextPreview(value);

    expect(preview.truncated).toBe(true);
    expect(preview.content.split("\n")).toHaveLength(MAX_MANAGED_PREVIEW_LINES);
  });

  test("bounds text previews by UTF-8 byte length without splitting a surrogate pair", () => {
    const preview = createManagedTextPreview(
      `${"a".repeat(MAX_MANAGED_PREVIEW_BYTES - 1)}😀`,
    );

    expect(preview.truncated).toBe(true);
    expect(new TextEncoder().encode(preview.content).byteLength).toBeLessThanOrEqual(
      MAX_MANAGED_PREVIEW_BYTES,
    );
    expect(preview.content.endsWith("\uFFFD")).toBe(false);
  });
});
