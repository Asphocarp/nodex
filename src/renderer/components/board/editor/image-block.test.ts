import { describe, expect, test } from "vite-plus/test";
import { formatImageFileSize, resolveExternalImageSource } from "./image-block";

describe("image block external source resolution", () => {
  test("resolves a canonical managed locator to app://fs", () => {
    const resolved = resolveExternalImageSource(
      "nodex://assets/plan.png",
      () => "/profile/assets/plan.png",
    );
    expect(resolved).toBe("app://fs/@fs/profile/assets/plan.png");
  });

  test("keeps standard URLs unchanged", () => {
    const source = "https://example.com/plan.png";
    expect(resolveExternalImageSource(source)).toBe(source);
  });

  test("formats image sizes like the compact file row", () => {
    expect(formatImageFileSize(10137)).toBe("9.9 KiB");
    expect(formatImageFileSize(512)).toBe("512 B");
    expect(formatImageFileSize(1024 * 1024)).toBe("1 MiB");
  });
});
