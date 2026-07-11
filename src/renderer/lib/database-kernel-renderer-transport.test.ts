import { describe, expect, test } from "bun:test";
import type { DatabaseMutationRequest } from "../../shared/database-kernel";
import { browserRendererTransport } from "./browser-renderer-transport";

const request: DatabaseMutationRequest = {
  version: 1,
  operationId: "renderer-database-operation",
  projectId: "project/one",
  storeEpoch: "epoch-1",
  clientSessionId: "renderer-session",
  actor: { kind: "renderer_test" },
  operations: [
    {
      kind: "position_card",
      viewId: "view/one",
      cardBlockId: "card/one",
      expectedPositionRevision: 1,
      groupKey: null,
    },
  ],
};

describe("Database renderer transport", () => {
  test("maps typed mutation and read commands to encoded browser routes", async () => {
    const originalFetch = globalThis.fetch;
    const urls: string[] = [];
    const bodies: unknown[] = [];
    const responses = [
      {
        ok: true,
        value: {
          version: 1,
          operationId: request.operationId,
          projectId: request.projectId,
          storeEpoch: request.storeEpoch,
          operationKinds: ["position_card"],
          duplicate: false,
          payload: { operationResults: [] },
          changeLogSeq: 4,
          committedAt: "2026-07-11T00:00:00.000Z",
        },
      },
      {
        ok: true,
        value: {
          version: 1,
          projectId: request.projectId,
          storeEpoch: request.storeEpoch,
          changeLogSeq: 4,
          value: null,
        },
      },
      {
        ok: true,
        value: {
          version: 1,
          projectId: request.projectId,
          storeEpoch: request.storeEpoch,
          changeLogSeq: 4,
          value: null,
        },
      },
    ];
    globalThis.fetch = (async (input, init) => {
      urls.push(String(input));
      if (init?.body) bodies.push(JSON.parse(String(init.body)) as unknown);
      const response = responses.shift();
      if (!response) throw new Error("Unexpected Database renderer request");
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    try {
      const mutation = (await browserRendererTransport.invoke(
        "databases:mutate",
        request.projectId,
        request,
      )) as { readonly ok: boolean };
      expect(mutation.ok).toBeTrue();
      const descriptor = (await browserRendererTransport.invoke(
        "databases:descriptor:get",
        request.projectId,
        "database/one",
      )) as { readonly ok: boolean };
      expect(descriptor.ok).toBeTrue();
      const query = (await browserRendererTransport.invoke(
        "database-views:query",
        request.projectId,
        "view/one",
      )) as { readonly ok: boolean };
      expect(query.ok).toBeTrue();
      expect((bodies[0] as { readonly operationId?: string }).operationId).toBe(
        "renderer-database-operation",
      );
      expect(
        urls[0]?.endsWith("/api/projects/project%2Fone/database-mutations"),
      ).toBeTrue();
      expect(
        urls[1]?.endsWith(
          "/api/projects/project%2Fone/databases/database%2Fone",
        ),
      ).toBeTrue();
      expect(
        urls[2]?.endsWith(
          "/api/projects/project%2Fone/database-views/view%2Fone/query",
        ),
      ).toBeTrue();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
