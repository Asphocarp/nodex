import { describe, expect, test } from "vitest";
import { writeImageToClipboard } from "./clipboard-image-writer";

class FakeImage {
  constructor(private readonly empty: boolean) {}

  isEmpty(): boolean {
    return this.empty;
  }
}

describe("clipboard image writer", () => {
  test("writes asset-backed image bytes to the native clipboard", async () => {
    const writeCalls: FakeImage[] = [];
    const result = await writeImageToClipboard("nodex://assets/diagram.png", {
      resolveAssetPath: (fileName) => `/tmp/${fileName}`,
      readFile: async (filePath) => Buffer.from(filePath),
      nativeImageApi: {
        createFromBuffer: () => new FakeImage(false),
        createFromDataURL: () => new FakeImage(false),
      },
      clipboardTarget: {
        writeImage: (image) => {
          writeCalls.push(image as FakeImage);
        },
      },
    });

    expect(result.ok).toBe(true);
    expect(writeCalls.length).toBe(1);
  });

  test("writes absolute local file images to the native clipboard", async () => {
    const writeCalls: FakeImage[] = [];
    const result = await writeImageToClipboard("/Users/me/image.png", {
      readFile: async (filePath) => Buffer.from(filePath),
      nativeImageApi: {
        createFromBuffer: () => new FakeImage(false),
        createFromDataURL: () => new FakeImage(false),
      },
      clipboardTarget: {
        writeImage: (image) => {
          writeCalls.push(image as FakeImage);
        },
      },
    });

    expect(result.ok).toBe(true);
    expect(writeCalls.length).toBe(1);
  });

  test("fetches remote images and writes the decoded native image", async () => {
    const writeCalls: FakeImage[] = [];
    const result = await writeImageToClipboard("https://example.com/hero.png", {
      fetchImpl: async () =>
        ({
          ok: true,
          arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
        }) as Response,
      nativeImageApi: {
        createFromBuffer: () => new FakeImage(false),
        createFromDataURL: () => new FakeImage(false),
      },
      clipboardTarget: {
        writeImage: (image) => {
          writeCalls.push(image as FakeImage);
        },
      },
      readFile: async () => Buffer.from("unused"),
      resolveAssetPath: (fileName) => fileName,
    });

    expect(result.ok).toBe(true);
    expect(writeCalls.length).toBe(1);
  });

  test("returns a decode error when the image format cannot be converted", async () => {
    const writeCalls: FakeImage[] = [];
    const result = await writeImageToClipboard("https://example.com/file.bin", {
      fetchImpl: async () =>
        ({
          ok: true,
          arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
        }) as Response,
      nativeImageApi: {
        createFromBuffer: () => new FakeImage(true),
        createFromDataURL: () => new FakeImage(true),
      },
      clipboardTarget: {
        writeImage: (image) => {
          writeCalls.push(image as FakeImage);
        },
      },
      readFile: async () => Buffer.from("unused"),
      resolveAssetPath: (fileName) => fileName,
    });

    expect(result.ok).toBe(false);
    expect("message" in result ? result.message : "").toBe(
      "Could not decode this image format for clipboard copy.",
    );
    expect(writeCalls.length).toBe(0);
  });

  test("returns a copy failure for invalid image sources", async () => {
    const result = await writeImageToClipboard("relative/image.png", {
      readFile: async () => Buffer.from("unused"),
      nativeImageApi: {
        createFromBuffer: () => new FakeImage(false),
        createFromDataURL: () => new FakeImage(false),
      },
      clipboardTarget: {
        writeImage: () => undefined,
      },
      fetchImpl: async () =>
        ({
          ok: true,
          arrayBuffer: async () => new Uint8Array([1]).buffer,
        }) as Response,
      resolveAssetPath: (fileName) => fileName,
    });

    expect(result.ok).toBe(false);
    expect("message" in result ? result.message : "").toBe("Could not copy image.");
  });
});
