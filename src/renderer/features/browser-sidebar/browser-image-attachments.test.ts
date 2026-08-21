import { afterEach, describe, expect, test, vi } from "vitest";
import {
  consumeBrowserImageAttachments,
  getBrowserImageAttachmentsSnapshot,
  publishBrowserImageAttachment,
  subscribeBrowserImageAttachments,
} from "./browser-image-attachments";

const conversationId = "browser-image-test";

afterEach(() => {
  consumeBrowserImageAttachments(
    conversationId,
    getBrowserImageAttachmentsSnapshot(conversationId).map((attachment) => attachment.id),
  );
});

describe("browser image attachments", () => {
  test("queues opaque managed images until the matching composer consumes them", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeBrowserImageAttachments(listener);
    publishBrowserImageAttachment(conversationId, {
      id: "image-1",
      filename: "preview.png",
      source: "nodex://assets/image-1.png",
    });

    expect(getBrowserImageAttachmentsSnapshot(conversationId)).toEqual([
      {
        id: "image-1",
        filename: "preview.png",
        source: "nodex://assets/image-1.png",
      },
    ]);
    consumeBrowserImageAttachments(conversationId, ["image-1"]);
    expect(getBrowserImageAttachmentsSnapshot(conversationId)).toEqual([]);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  test("deduplicates retries by managed attachment id", () => {
    const base = {
      id: "image-1",
      filename: "first.png",
      source: "nodex://assets/image-1.png",
    };
    publishBrowserImageAttachment(conversationId, base);
    publishBrowserImageAttachment(conversationId, {
      ...base,
      filename: "renamed.png",
    });

    expect(getBrowserImageAttachmentsSnapshot(conversationId)).toHaveLength(1);
    expect(getBrowserImageAttachmentsSnapshot(conversationId)[0]?.filename).toBe("renamed.png");
  });

  test("rejects display URLs that cannot cross the app-server attachment boundary", () => {
    expect(() =>
      publishBrowserImageAttachment(conversationId, {
        id: "image-1",
        filename: "preview.png",
        source: "nodex-asset://managed/image-1.png",
      }),
    ).toThrow("Browser image attachment is incomplete");
  });
});
