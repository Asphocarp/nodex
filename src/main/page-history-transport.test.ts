import { describe, expect, test } from "vitest";
import { Hono } from "hono";
import {
  PAGE_HISTORY_CONTRACT_VERSION,
  type PageHistoryPage,
  type ListPageHistoryRequest,
} from "../shared/page-history";
import type { PageHistoryCommandResult } from "../shared/page-history-transport";
import {
  PAGE_HISTORY_LIST_IPC_CHANNEL,
  registerPageHistoryIpcHandler,
  type PageHistoryIpcDependencies,
} from "./page-history-ipc";
import { registerPageHistoryHttpRoute } from "./page-history-http";

const page: PageHistoryPage = {
  version: PAGE_HISTORY_CONTRACT_VERSION,
  libraryId: "library/one",
  pageId: "card/one",
  documentId: "document/one",
  entries: [],
  nextCursor: null,
};

describe("canonical Page history transports", () => {
  test("keeps the HTTP route scope, page size, and cursor exact", async () => {
    const requests: ListPageHistoryRequest[] = [];
    const app = new Hono();
    registerPageHistoryHttpRoute(app, {
      listHistory: async (request) => {
        requests.push(request);
        return { ok: true, value: page };
      },
    });
    const response = await app.request(
      `/api/projects/project%2Fone/pages/card%2Fone/history?pageSize=20&beforeSource=change_log&beforeOccurredAt=${encodeURIComponent("2026-07-12T08:00:00.000Z")}&beforeChangeSeq=42`,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(requests[0]?.requestingProjectId).toBe("project/one");
    expect(requests[0]?.pageId).toBe("card/one");
    expect(requests[0]?.pageSize).toBe(20);
    expect(requests[0]?.before?.source).toBe("change_log");
    expect(
      requests[0]?.before?.source === "change_log" &&
        requests[0].before.changeSeq === 42,
    ).toBe(true);

    const incomplete = await app.request(
      "/api/projects/project%2Fone/pages/card%2Fone/history?beforeSource=change_log&beforeChangeSeq=42",
    );
    expect(incomplete.status).toBe(400);
    expect(requests.length).toBe(1);
  });

  test("maps durable not-found and reader failure without leaking exceptions", async () => {
    const app = new Hono();
    let calls = 0;
    registerPageHistoryHttpRoute(app, {
      listHistory: async (): Promise<PageHistoryCommandResult> => {
        calls += 1;
        if (calls === 1) {
          return {
            ok: false,
            error: {
              code: "page_not_found",
              message: "Page does not exist in this Project",
              retryable: false,
            },
          };
        }
        throw new Error("reader stopped");
      },
    });
    const notFound = await app.request(
      "/api/projects/project/pages/missing/history",
    );
    expect(notFound.status).toBe(404);
    const unavailable = await app.request(
      "/api/projects/project/pages/missing/history",
    );
    expect(unavailable.status).toBe(500);
    const body = (await unavailable.json()) as PageHistoryCommandResult;
    expect(body.ok).toBe(false);
    if (body.ok) return;
    expect(body.error.code).toBe("unknown");
    expect(body.error.retryable).toBe(true);
  });

  test("requires a trusted IPC event and rejects non-canonical requests", async () => {
    let listener:
      | ((event: unknown, request: unknown) => Promise<PageHistoryCommandResult>)
      | undefined;
    let calls = 0;
    const registerHandle: PageHistoryIpcDependencies["registerHandle"] = (
      channel,
      handler,
    ) => {
      expect(channel).toBe(PAGE_HISTORY_LIST_IPC_CHANNEL);
      listener = handler;
    };
    registerPageHistoryIpcHandler({
      registerHandle,
      isTrustedEvent: (event) => event === "trusted",
      listHistory: async () => {
        calls += 1;
        return { ok: true, value: page };
      },
    });
    const request = {
      version: PAGE_HISTORY_CONTRACT_VERSION,
      requestingProjectId: "project/one",
      pageId: page.pageId,
      pageSize: 10,
    };
    const untrusted = await listener?.("untrusted", request);
    expect(untrusted?.ok).toBe(false);
    expect(calls).toBe(0);
    const trusted = await listener?.("trusted", request);
    expect(trusted?.ok).toBe(true);
    expect(calls).toBe(1);
    const invalid = await listener?.("trusted", {
      ...request,
      rawSql: "SELECT *",
    });
    expect(invalid?.ok).toBe(false);
    expect(calls).toBe(1);
  });
});
