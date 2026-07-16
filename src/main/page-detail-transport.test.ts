import { Hono } from "hono";
import { describe, expect, test } from "vitest";
import type { PageDetailResult } from "../shared/page-detail";
import { registerPageDetailHttpRoute } from "./page-detail-http";
import {
  PAGE_DETAIL_IPC_CHANNEL,
  registerPageDetailIpcHandler,
} from "./page-detail-ipc";

const result = (): PageDetailResult => ({
  ok: false,
  error: { code: "page_not_found", message: "Page does not exist", retryable: false },
});

describe("Page Detail transport", () => {
  test("keeps IPC and HTTP Project/Page coordinates equivalent", async () => {
    const reads: string[] = [];
    const read = async (projectId: string, pageId: string) => {
      reads.push(`${projectId}:${pageId}`);
      return result();
    };
    let handler:
      | ((event: unknown, projectId: string, pageId: string) => Promise<PageDetailResult>)
      | undefined;
    registerPageDetailIpcHandler({
      registerHandle: (channel, listener) => {
        expect(channel).toBe(PAGE_DETAIL_IPC_CHANNEL);
        handler = listener;
      },
      isTrustedEvent: (event) => event === "trusted",
      read,
    });
    const ipc = await handler?.("trusted", "project-1", "page-1");
    const denied = await handler?.("subframe", "project-1", "page-1");
    expect(denied).toMatchObject({
      ok: false,
      error: { code: "authorization_denied" },
    });

    const app = new Hono();
    registerPageDetailHttpRoute(app, { read });
    const response = await app.request(
      "/api/projects/project-1/pages/page-1",
    );
    expect(response.status).toBe(404);
    expect(JSON.stringify(ipc)).toBe(JSON.stringify(await response.json()));
    expect(reads).toEqual(["project-1:page-1", "project-1:page-1"]);
  });
});
