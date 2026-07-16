import { describe, expect, test } from "vitest";
import type { DatabaseApply } from "../../shared/database-module";
import { browserRendererTransport } from "./browser-renderer-transport";

describe("Database Module renderer transport", () => {
  test("maps typed read and apply commands to Project-scoped HTTP routes", async () => {
    const originalFetch = globalThis.fetch;
    const urls: string[] = [];
    const bodies: unknown[] = [];
    const responses = [
      {
        ok: true,
        value: {
          version: 1,
          projectId: "project/one",
          libraryId: "library-1",
          storeEpoch: "epoch-1",
          changeLogSeq: 2,
          value: { kind: "catalog", databases: [] },
        },
      },
      {
        ok: true,
        value: {
          version: 1,
          operationId: "operation-1",
          projectId: "project/one",
          libraryId: "library-1",
          storeEpoch: "epoch-1",
          duplicate: false,
          operationKinds: ["set_value"],
          affectedDatabaseIds: [],
          affectedDataSourceIds: ["source-1"],
          affectedPageIds: ["page-1"],
          affectedViewIds: [],
          committedRevisions: { "value:page-1:property-1": 2 },
          changeLogSeq: 3,
          committedAt: "2026-07-16T00:00:00.000Z",
        },
      },
    ];
    globalThis.fetch = (async (input, init) => {
      urls.push(String(input));
      bodies.push(JSON.parse(String(init?.body)) as unknown);
      const response = responses.shift();
      if (!response) throw new Error("Unexpected Database Module request");
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const readRequest = {
      version: 1 as const,
      projectId: "project/one",
      read: {
        target: { kind: "project_default" as const },
        mode: "catalog" as const,
      },
    };
    const applyRequest: DatabaseApply = {
      version: 1,
      operationId: "operation-1",
      projectId: "project/one",
      storeEpoch: "epoch-1",
      actor: { kind: "renderer" },
      operations: [
        {
          kind: "set_value",
          pageId: "page-1",
          dataSourceId: "source-1",
          propertyId: "property-1",
          expectedValueRevision: 1,
          value: "Done",
        },
      ],
    };

    try {
      const read = (await browserRendererTransport.invoke(
        "database-module:read",
        "project/one",
        readRequest,
      )) as { readonly ok: boolean };
      const apply = (await browserRendererTransport.invoke(
        "database-module:apply",
        "project/one",
        applyRequest,
      )) as { readonly ok: boolean };
      expect(read.ok).toBe(true);
      expect(apply.ok).toBe(true);
      expect(urls[0]?.endsWith(
        "/api/projects/project%2Fone/database-module/read",
      )).toBe(true);
      expect(urls[1]?.endsWith(
        "/api/projects/project%2Fone/database-module/apply",
      )).toBe(true);
      expect(bodies).toEqual([readRequest, applyRequest]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
