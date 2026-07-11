import { describe, expect, test } from "vitest";
import { Hono } from "hono";
import {
  CARD_HISTORY_CONTRACT_VERSION,
  type CardHistoryPage,
  type ListCardHistoryRequest,
} from "../shared/card-history";
import type { CardHistoryCommandResult } from "../shared/card-history-transport";
import {
  CARD_HISTORY_LIST_IPC_CHANNEL,
  registerCardHistoryIpcHandler,
  type CardHistoryIpcDependencies,
} from "./card-history-ipc";
import { registerCardHistoryHttpRoute } from "./card-history-http";

const page: CardHistoryPage = {
  version: CARD_HISTORY_CONTRACT_VERSION,
  projectId: "project/one",
  cardBlockId: "card/one",
  documentId: "document/one",
  entries: [],
  nextCursor: null,
};

describe("canonical Card history transports", () => {
  test("keeps the HTTP route scope, page size, and cursor exact", async () => {
    const requests: ListCardHistoryRequest[] = [];
    const app = new Hono();
    registerCardHistoryHttpRoute(app, {
      listHistory: async (request) => {
        requests.push(request);
        return { ok: true, value: page };
      },
    });
    const response = await app.request(
      `/api/projects/project%2Fone/cards/card%2Fone/history?pageSize=20&beforeSource=change_log&beforeOccurredAt=${encodeURIComponent("2026-07-12T08:00:00.000Z")}&beforeChangeSeq=42`,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(requests[0]?.projectId).toBe("project/one");
    expect(requests[0]?.cardBlockId).toBe("card/one");
    expect(requests[0]?.pageSize).toBe(20);
    expect(requests[0]?.before?.source).toBe("change_log");
    expect(
      requests[0]?.before?.source === "change_log" &&
        requests[0].before.changeSeq === 42,
    ).toBe(true);

    const incomplete = await app.request(
      "/api/projects/project%2Fone/cards/card%2Fone/history?beforeSource=change_log&beforeChangeSeq=42",
    );
    expect(incomplete.status).toBe(400);
    expect(requests.length).toBe(1);
  });

  test("maps durable not-found and reader failure without leaking exceptions", async () => {
    const app = new Hono();
    let calls = 0;
    registerCardHistoryHttpRoute(app, {
      listHistory: async (): Promise<CardHistoryCommandResult> => {
        calls += 1;
        if (calls === 1) {
          return {
            ok: false,
            error: {
              code: "card_not_found",
              message: "Card does not exist in this Project",
              retryable: false,
            },
          };
        }
        throw new Error("reader stopped");
      },
    });
    const notFound = await app.request(
      "/api/projects/project/cards/missing/history",
    );
    expect(notFound.status).toBe(404);
    const unavailable = await app.request(
      "/api/projects/project/cards/missing/history",
    );
    expect(unavailable.status).toBe(500);
    const body = (await unavailable.json()) as CardHistoryCommandResult;
    expect(body.ok).toBe(false);
    if (body.ok) return;
    expect(body.error.code).toBe("unknown");
    expect(body.error.retryable).toBe(true);
  });

  test("requires a trusted IPC event and rejects non-canonical requests", async () => {
    let listener:
      | ((event: unknown, request: unknown) => Promise<CardHistoryCommandResult>)
      | undefined;
    let calls = 0;
    const registerHandle: CardHistoryIpcDependencies["registerHandle"] = (
      channel,
      handler,
    ) => {
      expect(channel).toBe(CARD_HISTORY_LIST_IPC_CHANNEL);
      listener = handler;
    };
    registerCardHistoryIpcHandler({
      registerHandle,
      isTrustedEvent: (event) => event === "trusted",
      listHistory: async () => {
        calls += 1;
        return { ok: true, value: page };
      },
    });
    const request = {
      version: CARD_HISTORY_CONTRACT_VERSION,
      projectId: page.projectId,
      cardBlockId: page.cardBlockId,
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
