import { describe, expect, test } from "vitest";

import type { LibraryPageDetailResult } from "../shared/page-detail";
import {
  LIBRARY_PAGE_DETAIL_IPC_CHANNEL,
  registerLibraryPageDetailIpcHandler,
} from "./library-page-detail-ipc";

const missing = (): LibraryPageDetailResult => ({
  ok: false,
  error: { code: "page_not_found", message: "Page does not exist", retryable: false },
});

describe("Library Page Detail transport", () => {
  test("uses trusted Library routes without accepting a Project identity", async () => {
    const pageIds: string[] = [];
    const read = async (pageId: string): Promise<LibraryPageDetailResult> => {
      pageIds.push(pageId);
      return missing();
    };
    const handlers = new Map<
      string,
      (event: unknown, pageId: string) => Promise<LibraryPageDetailResult>
    >();
    registerLibraryPageDetailIpcHandler({
      registerHandle: (channel, handler) => handlers.set(channel, handler),
      isTrustedEvent: (event) => event === "trusted",
      read,
    });
    expect(await handlers.get(LIBRARY_PAGE_DETAIL_IPC_CHANNEL)?.("trusted", "page/one")).toEqual(
      missing(),
    );
    expect(
      await handlers.get(LIBRARY_PAGE_DETAIL_IPC_CHANNEL)?.("subframe", "page/two"),
    ).toMatchObject({ ok: false, error: { code: "authorization_denied" } });

    expect(pageIds).toEqual(["page/one"]);
  });
});
