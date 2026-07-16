import { describe, expect, test } from "vitest";
import { browserRendererTransport } from "./browser-renderer-transport";

describe("Page Detail renderer transport", () => {
  test("uses the encoded Project-scoped Page route", async () => {
    const originalFetch = globalThis.fetch;
    let requestedUrl = "";
    globalThis.fetch = (async (input) => {
      requestedUrl = String(input);
      return new Response(JSON.stringify({
        ok: true,
        value: {
          version: 1,
          projectId: "project/one",
          libraryId: "library-1",
          storeEpoch: "epoch-1",
          changeLogSeq: 2,
          page: {
            pageId: "page/one",
            libraryId: "library-1",
            parent: { kind: "library", libraryId: "library-1" },
            lifecycle: "active",
            parentRevision: 1,
            metadataRevision: 1,
            documentId: "document-1",
            documentGeneration: 1,
            documentHeadSeq: 1,
            title: "Page",
            richTitle: [{ type: "text", text: "Page", styles: {} }],
            preview: "Body",
            plainText: "Page\nBody",
            createdAt: "2026-07-16T00:00:00.000Z",
            updatedAt: "2026-07-16T00:00:00.000Z",
          },
          document: {
            readiness: "ready",
            schemaKey: "nodex.page",
            schemaVersion: 1,
          },
          intrinsicProperties: [],
          dataSourceContext: { kind: "standalone" },
        },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;

    try {
      const result = (await browserRendererTransport.invoke(
        "pages:detail:get",
        "project/one",
        "page/one",
      )) as { readonly ok: boolean };
      expect(result.ok).toBe(true);
      expect(requestedUrl.endsWith(
        "/api/projects/project%2Fone/pages/page%2Fone",
      )).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("uses Page identity for Database row reads", async () => {
    const originalFetch = globalThis.fetch;
    let requestedUrl = "";
    globalThis.fetch = (async (input) => {
      requestedUrl = String(input);
      return new Response(JSON.stringify(null), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    try {
      const result = await browserRendererTransport.invoke(
        "database-row:get",
        "project/one",
        "page/one",
      );
      expect(result).toBe(null);
      expect(requestedUrl.endsWith(
        "/api/projects/project%2Fone/database-row?pageId=page%2Fone",
      )).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
