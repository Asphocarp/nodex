import { describe, expect, test } from "vitest";
import {
  ImageAssetResolutionError,
  blobToDataUrl,
  classifyImageAssetSource,
  createImageDownloadFilename,
  dataUrlToBlob,
  fetchImageSourceAsDataUrl,
  materializeImageSourceAsDataUrl,
  resolveImageDisplaySource,
} from "./resolved-image-asset";

describe("resolved image assets", () => {
  test("classifies data, managed, pointer, remote, and local sources", () => {
    expect(classifyImageAssetSource("data:image/png;base64,YQ==").kind).toBe("data");
    expect(classifyImageAssetSource("nodex://assets/hero.png").kind).toBe("managed");
    expect(classifyImageAssetSource("nodex://assets/folder/hero.png").kind).toBe("invalid");
    expect(classifyImageAssetSource("file-service://asset-1").kind).toBe("pointer");
    expect(classifyImageAssetSource("https://example.test/hero.png").kind).toBe("remote");
    expect(classifyImageAssetSource("nodex-asset://managed/hero.png").kind).toBe("direct");
    expect(classifyImageAssetSource("data:text/plain,hello").kind).toBe("invalid");
    expect(classifyImageAssetSource("/tmp/hero.png")).toMatchObject({
      kind: "local",
      localPath: "/tmp/hero.png",
    });
    expect(classifyImageAssetSource("file:///tmp/hero.png")).toMatchObject({
      kind: "local",
      localPath: "/tmp/hero.png",
    });
    expect(classifyImageAssetSource("javascript:alert(1)").kind).toBe("invalid");
  });

  test("only exposes local display URLs when the caller owns local-path access", () => {
    expect(resolveImageDisplaySource("/tmp/hero.png", { allowLocalPath: false })).toBe(null);
    expect(resolveImageDisplaySource("/tmp/hero.png", { allowLocalPath: true })).toBe(
      "file:///tmp/hero.png",
    );
    expect(resolveImageDisplaySource("nodex://assets/hero.png", { allowLocalPath: false })).toBe(
      "nodex-asset://managed/hero.png",
    );
  });

  test("round trips binary and percent-encoded data URLs", async () => {
    const encoded = await blobToDataUrl(
      new Blob([new Uint8Array([0, 1, 2, 255])], {
        type: "image/png",
      }),
    );
    expect(encoded).toBe("data:image/png;base64,AAEC/w==");
    expect(new Uint8Array(await dataUrlToBlob(encoded).arrayBuffer())).toEqual(
      new Uint8Array([0, 1, 2, 255]),
    );
    expect(await dataUrlToBlob("data:image/svg+xml,%3Csvg%3E%3C/svg%3E").text()).toBe(
      "<svg></svg>",
    );
  });

  test("materializes successful remote images and rejects non-2xx responses", async () => {
    const fetchSuccess = async () =>
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-type": "image/webp" },
      });
    await expect(
      fetchImageSourceAsDataUrl("https://example.test/hero.webp", fetchSuccess as typeof fetch),
    ).resolves.toBe("data:image/webp;base64,AQID");

    const fetchFailure = async () => new Response(null, { status: 404 });
    await expect(
      fetchImageSourceAsDataUrl("https://example.test/missing.png", fetchFailure as typeof fetch),
    ).rejects.toEqual(
      expect.objectContaining({
        name: "ImageAssetResolutionError",
        status: 404,
      }),
    );
  });

  test("uses the source-specific materializer without weakening local access", async () => {
    await expect(
      materializeImageSourceAsDataUrl("/tmp/hero.png", {
        readLocalFile: async (path) => `data:image/png;base64,${path.length}`,
      }),
    ).resolves.toBe("data:image/png;base64,13");
    await expect(
      materializeImageSourceAsDataUrl("file-service://asset-1", {
        resolvePointer: async () => "data:image/jpeg;base64,YQ==",
      }),
    ).resolves.toBe("data:image/jpeg;base64,YQ==");
    await expect(materializeImageSourceAsDataUrl("/tmp/hero.png")).rejects.toBeInstanceOf(
      ImageAssetResolutionError,
    );
  });

  test("derives safe download filenames", () => {
    expect(
      createImageDownloadFilename(
        "data:image/jpeg;base64,YQ==",
        undefined,
        new Date("2026-08-13T12:34:56Z"),
      ),
    ).toMatch(/^Nodex Image .*\.jpg$/u);
    expect(createImageDownloadFilename("data:image/png;base64,YQ==", "before/after.png")).toBe(
      "before_after.png",
    );
  });
});
