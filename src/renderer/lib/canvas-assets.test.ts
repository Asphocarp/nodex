import { describe, expect, test } from "vitest";
import {
  CanvasBinaryFileResolver,
  collectCanvasReferencedFileIds,
  materializeDurableCanvasFiles,
  resolveCanvasBinaryFiles,
} from "./canvas-assets";

describe("Canvas managed asset bridge", () => {
  test("keeps only active image files and uploads new payloads before return", async () => {
    const uploadOrder: string[] = [];
    const durable = await materializeDurableCanvasFiles({
      elementsIncludingDeleted: [
        { id: "image", type: "image", fileId: "new", isDeleted: false },
        { id: "deleted", type: "image", fileId: "old", isDeleted: true },
      ],
      binaryFiles: {
        new: {
          id: "new",
          mimeType: "image/png",
          dataURL: "data:image/png;base64,AA==",
          created: 10,
        },
      },
      current: {},
      dependencies: {
        uploadImage: async () => {
          uploadOrder.push("uploaded");
          return "nodex://assets/new.png";
        },
      },
    });
    expect(uploadOrder.join(",")).toBe("uploaded");
    expect(Object.keys(durable).join(",")).toBe("new");
    expect(durable.new?.source).toBe("nodex://assets/new.png");
    expect(
      [...collectCanvasReferencedFileIds([{ type: "image", fileId: "new" }])]
        .join(","),
    ).toBe("new");
  });

  test("resolves durable refs into disposable Excalidraw binary data", async () => {
    const files = await resolveCanvasBinaryFiles(
      {
        image: {
          id: "image",
          mimeType: "image/png",
          source: "nodex://assets/image.png",
          created: 5,
        },
      },
      {
        fetchAsset: async () => new Response("bytes"),
        blobToDataUrl: async () => "data:image/png;base64,Ynl0ZXM=",
        now: () => 20,
      },
    );
    expect(files.image?.dataURL).toBe("data:image/png;base64,Ynl0ZXM=");
    expect(files.image?.created).toBe(5);
    expect(files.image?.lastRetrieved).toBe(20);
  });

  test("incrementally resolves unchanged files and prunes unreferenced cache entries", async () => {
    const fetched: string[] = [];
    const resolver = new CanvasBinaryFileResolver({
      fetchAsset: async (url) => {
        fetched.push(url);
        return new Response(url);
      },
      blobToDataUrl: async (blob) => `data:${await blob.text()}`,
      now: () => 50,
    });
    const first = await resolver.resolve({
      first: {
        id: "first",
        mimeType: "image/png",
        source: "nodex://assets/first.png",
        created: 1,
      },
      second: {
        id: "second",
        mimeType: "image/png",
        source: "nodex://assets/second.png",
        created: 2,
      },
    });
    expect(fetched.length).toBe(2);
    expect(Object.keys(first).join(",")).toBe("first,second");

    const retained = await resolver.resolve({
      first: {
        id: "first",
        mimeType: "image/png",
        source: "nodex://assets/first.png",
        created: 9,
      },
    });
    expect(fetched.length).toBe(2);
    expect(retained.first?.created).toBe(9);

    await resolver.resolve({
      first: {
        id: "first",
        mimeType: "image/webp",
        source: "nodex://assets/first-v2.webp",
      },
      second: {
        id: "second",
        mimeType: "image/png",
        source: "nodex://assets/second.png",
      },
    });
    expect(fetched.length).toBe(4);
    resolver.clear();
    await resolver.resolve({
      first: {
        id: "first",
        mimeType: "image/webp",
        source: "nodex://assets/first-v2.webp",
      },
    });
    expect(fetched.length).toBe(5);
    resolver.destroy();
  });

  test("shares concurrent in-flight reads and retries a failed asset", async () => {
    let fetchCount = 0;
    let fail = true;
    const resolver = new CanvasBinaryFileResolver({
      fetchAsset: async () => {
        fetchCount += 1;
        if (fail) return new Response(null, { status: 503 });
        return new Response("ok");
      },
      blobToDataUrl: async () => "data:image/png;base64,b2s=",
    });
    const files = {
      image: {
        id: "image",
        mimeType: "image/png",
        source: "nodex://assets/image.png",
      },
    } as const;
    const first = resolver.resolve(files);
    const second = resolver.resolve(files);
    let firstError: unknown;
    let secondError: unknown;
    try {
      await first;
    } catch (error) {
      firstError = error;
    }
    try {
      await second;
    } catch (error) {
      secondError = error;
    }
    expect(firstError instanceof Error).toBe(true);
    expect(secondError instanceof Error).toBe(true);
    expect(fetchCount).toBe(1);

    fail = false;
    const retried = await resolver.resolve(files);
    expect(fetchCount).toBe(2);
    expect(retried.image?.dataURL).toBe("data:image/png;base64,b2s=");
    resolver.destroy();
    let destroyedError: unknown;
    try {
      await resolver.resolve(files);
    } catch (error) {
      destroyedError = error;
    }
    expect(destroyedError instanceof Error).toBe(true);
  });
});
