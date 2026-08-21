import { describe, expect, test } from "vitest";
import { type PageHistoryPage } from "../shared/page-history";
import type { PageHistoryCommandResult } from "../shared/page-history-transport";
import {
  PAGE_HISTORY_LIST_IPC_CHANNEL,
  registerPageHistoryIpcHandler,
  type PageHistoryIpcDependencies,
} from "./page-history-ipc";

const page: PageHistoryPage = {
  libraryId: "library/one",
  pageId: "card/one",
  documentId: "document/one",
  entries: [],
  nextCursor: null,
};

describe("canonical Page history IPC", () => {
  test("requires a trusted IPC event and rejects non-canonical requests", async () => {
    let listener:
      | ((event: unknown, request: unknown) => Promise<PageHistoryCommandResult>)
      | undefined;
    let calls = 0;
    const registerHandle: PageHistoryIpcDependencies["registerHandle"] = (channel, handler) => {
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
