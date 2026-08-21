import { describe, expect, test } from "vite-plus/test";
import {
  CanvasBinaryFileResolver,
  collectCanvasReferencedFileIds,
  materializeDurableCanvasFiles,
  resolveCanvasBinaryFiles,
} from "./canvas-assets";
import { CanvasSceneStagedFileCatalog } from "./canvas-scene-binding";

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
        materializeImage: async () => {
          uploadOrder.push("uploaded");
          return {
            source: "nodex://assets/new.png",
            fileName: "new.png",
            mimeType: "image/png",
            contentHash: "a".repeat(64),
            byteLength: 1,
          };
        },
      },
    });
    expect(uploadOrder.join(",")).toBe("uploaded");
    expect(Object.keys(durable).join(",")).toBe("new");
    expect(durable.new?.source).toBe("nodex://assets/new.png");
    expect([...collectCanvasReferencedFileIds([{ type: "image", fileId: "new" }])].join(",")).toBe(
      "new",
    );
  });

  test("single-flights the same staged file across concurrent surface ports", async () => {
    const catalog = new CanvasSceneStagedFileCatalog();
    let materializationCount = 0;
    const request = {
      elementsIncludingDeleted: [
        { id: "image", type: "image", fileId: "shared", isDeleted: false },
      ],
      binaryFiles: {
        shared: {
          id: "shared",
          mimeType: "image/png",
          dataURL: "data:image/png;base64,AA==",
          created: 10,
        },
      },
      current: {},
      getAccepted: () => ({}),
      dependencies: {
        materializeImage: async () => {
          materializationCount += 1;
          return {
            source: "nodex://assets/shared.png",
            fileName: "shared.png",
            mimeType: "image/png",
            contentHash: "a".repeat(64),
            byteLength: 1,
          };
        },
      },
    } as const;

    const [first, second] = await Promise.all([
      catalog.materialize(request),
      catalog.materialize(request),
    ]);

    expect(materializationCount).toBe(1);
    expect(first.shared).toEqual(second.shared);
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
        readAssetDataUrl: async () => "data:image/png;base64,Ynl0ZXM=",
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
      readAssetDataUrl: async (source) => {
        fetched.push(source);
        return `data:${source}`;
      },
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
      readAssetDataUrl: async () => {
        fetchCount += 1;
        if (fail) throw new Error("unavailable");
        return "data:image/png;base64,b2s=";
      },
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
