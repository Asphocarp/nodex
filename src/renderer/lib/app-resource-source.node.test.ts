import { describe, expect, test } from "vite-plus/test";
import {
  normalizeAppMediaResourceSource,
  normalizeEnvironmentAwareAppResourceSource,
} from "./app-resource-source";

describe("environment-aware generic app resources", () => {
  test("uses Vite /@fs only for HTTP(S) development surfaces", () => {
    expect(normalizeEnvironmentAwareAppResourceSource("/tmp/icon.png", "http:")).toBe(
      "/@fs/tmp/icon.png",
    );
    expect(normalizeEnvironmentAwareAppResourceSource("C:\\Apps\\icon.png", "https:")).toBe(
      "/@fs/C:/Apps/icon.png",
    );
    expect(normalizeEnvironmentAwareAppResourceSource("/tmp/icon.png", "app:")).toBe(
      "app://fs/@fs/tmp/icon.png",
    );
  });

  test.each([
    "app://fs/@fs/tmp/icon.png",
    "data:image/png;base64,YQ==",
    "https://example.test/icon.png",
    "http://localhost/icon.png",
    "/@fs/tmp/icon.png",
  ])("preserves an already-supported resource source: %s", (source) => {
    expect(normalizeEnvironmentAwareAppResourceSource(source, "http:")).toBe(source);
  });

  test.each(["file:///tmp/icon.png", "blob:https://example.test/id", "relative/icon.png", ""])(
    "rejects a source outside the generic icon contract: %s",
    (source) => {
      expect(normalizeEnvironmentAwareAppResourceSource(source, "app:")).toBe(null);
    },
  );
});

describe("conversation media resources", () => {
  test("uses the full app URL for local and managed media in every renderer mode", () => {
    expect(normalizeAppMediaResourceSource("/tmp/sound.mp3", "audio")).toBe(
      "app://fs/@fs/tmp/sound.mp3",
    );
    expect(normalizeAppMediaResourceSource("file:///tmp/image.png", "image")).toBe(
      "app://fs/@fs/tmp/image.png",
    );
    expect(
      normalizeAppMediaResourceSource(
        "nodex://assets/movie.mp4",
        "video",
        () => "/profile/assets/movie.mp4",
      ),
    ).toBe("app://fs/@fs/profile/assets/movie.mp4");
  });

  test.each([
    ["data:audio/wav;base64,YQ==", "audio"],
    ["https://example.test/image.png", "image"],
    ["blob:https://example.test/id", "video"],
    ["app://fs/@fs/tmp/image.png", "image"],
  ] as const)("preserves a supported %s source", (source, kind) => {
    expect(normalizeAppMediaResourceSource(source, kind)).toBe(source);
  });

  test("rejects mismatched data MIME, relative paths, and unavailable managed media", () => {
    expect(normalizeAppMediaResourceSource("data:image/png;base64,YQ==", "audio")).toBe(null);
    expect(normalizeAppMediaResourceSource("relative/image.png", "image")).toBe(null);
    expect(normalizeAppMediaResourceSource("nodex://assets/missing.png", "image", () => null)).toBe(
      null,
    );
  });
});
