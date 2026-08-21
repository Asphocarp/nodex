import { describe, expect, test, vi } from "vitest";
import { MAX_MANAGED_IMAGE_BYTES } from "../../shared/managed-assets";
import { fetchBrowserImage } from "./browser-image-attachment";

describe("fetchBrowserImage", () => {
  test("uses the page referrer and returns a supported bounded image", async () => {
    const fetch = vi.fn(
      async () =>
        new Response(new Uint8Array([137, 80, 78, 71]), {
          headers: { "content-type": "image/png; charset=binary" },
          status: 200,
        }),
    );

    await expect(
      fetchBrowserImage({
        fetch,
        pageUrl: "https://example.test/gallery",
        sourceUrl: "https://cdn.example.test/photo.png",
      }),
    ).resolves.toMatchObject({
      bytes: new Uint8Array([137, 80, 78, 71]),
      mimeType: "image/png",
      name: "photo.png",
    });
    expect(fetch).toHaveBeenCalledWith("https://cdn.example.test/photo.png", {
      referrer: "https://example.test/gallery",
    });
  });

  test("rejects credential-bearing and local-file sources before fetching", async () => {
    const fetch = vi.fn();

    await expect(
      fetchBrowserImage({
        fetch,
        pageUrl: "https://example.test",
        sourceUrl: "https://user:secret@example.test/image.png",
      }),
    ).rejects.toThrow("not allowed");
    await expect(
      fetchBrowserImage({
        fetch,
        pageUrl: "https://example.test",
        sourceUrl: "file:///Users/example/private.png",
      }),
    ).rejects.toThrow("not allowed");
    expect(fetch).not.toHaveBeenCalled();
  });

  test("rejects unsupported MIME types and declared oversized bodies", async () => {
    await expect(
      fetchBrowserImage({
        fetch: async () =>
          new Response("not an image", {
            headers: { "content-type": "text/html" },
          }),
        pageUrl: "https://example.test",
        sourceUrl: "https://example.test/image",
      }),
    ).rejects.toThrow("supported image");

    await expect(
      fetchBrowserImage({
        fetch: async () =>
          new Response(new Uint8Array([1]), {
            headers: {
              "content-length": String(MAX_MANAGED_IMAGE_BYTES + 1),
              "content-type": "image/png",
            },
          }),
        pageUrl: "https://example.test",
        sourceUrl: "https://example.test/image.png",
      }),
    ).rejects.toThrow("10MB");
  });
});
