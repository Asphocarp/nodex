import { describe, expect, test } from "vitest";
import { resolveRendererManualChunk } from "./renderer-manual-chunks";

describe("resolveRendererManualChunk", () => {
  test("isolates React runtime packages", () => {
    expect(
      resolveRendererManualChunk(
        "/Users/asc/repo/nodex/node_modules/react/index.js",
      ),
    ).toBe("vendor-react");
    expect(
      resolveRendererManualChunk(
        "C:\\repo\\nodex\\node_modules\\react-dom\\client.js",
      ),
    ).toBe("vendor-react");
  });

  test("keeps editor and markdown dependencies in one chunk", () => {
    expect(
      resolveRendererManualChunk(
        "/Users/asc/repo/nodex/node_modules/@streamdown/code/dist/index.js",
      ),
    ).toBe("vendor-editor-markdown");
    expect(
      resolveRendererManualChunk(
        "C:\\repo\\nodex\\node_modules\\streamdown\\dist\\index.js",
      ),
    ).toBe("vendor-editor-markdown");
    expect(
      resolveRendererManualChunk(
        "/Users/asc/repo/nodex/node_modules/@blocknote/core/dist/index.js",
      ),
    ).toBe("vendor-editor-markdown");
    expect(
      resolveRendererManualChunk(
        "/Users/asc/repo/nodex/third_party/blocknote/packages/core/src/index.ts",
      ),
    ).toBe("vendor-editor-markdown");
  });

  test("groups canvas dependencies together", () => {
    expect(
      resolveRendererManualChunk(
        "/Users/asc/repo/nodex/node_modules/@excalidraw/excalidraw/dist/prod/index.js",
      ),
    ).toBe("vendor-excalidraw");
  });

  test("groups graph dependencies together", () => {
    expect(
      resolveRendererManualChunk(
        "/Users/asc/repo/nodex/node_modules/cytoscape/dist/cytoscape.esm.mjs",
      ),
    ).toBe("vendor-cytoscape");
  });

  test("keeps local application modules in the entry graph", () => {
    expect(
      resolveRendererManualChunk(
        "/Users/asc/repo/nodex/src/renderer/components/workbench/stage-threads/markdown/markdown-core.tsx",
      ),
    ).toBe(undefined);
  });
});
