import { afterEach, describe, expect, test, vi } from "vitest";
import {
  clearBrowserAnnotationAttachments,
  getBrowserAnnotationAttachmentsSnapshot,
  publishBrowserAnnotationAttachment,
  removeBrowserAnnotationAttachment,
  replaceBrowserAnnotationAttachments,
  subscribeBrowserAnnotationAttachments,
} from "./browser-annotation-attachments";

afterEach(() => clearBrowserAnnotationAttachments("conversation-1"));

describe("Browser annotation attachments", () => {
  test("publishes bounded Browser evidence to the owning conversation", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeBrowserAnnotationAttachments(listener);
    publishBrowserAnnotationAttachment("conversation-1", {
      schemaVersion: 1,
      id: "attachment-1",
      browserTabId: "browser-tab-1",
      createdAt: 1,
      note: "Increase the spacing",
      pageTitle: "Example",
      pageUrl: "https://example.com/",
      anchors: [{
        id: "anchor-1",
        kind: "element",
        pageUrl: "https://example.com/",
        selector: "main > button",
        rect: { x: 1, y: 2, width: 10, height: 20 },
      }],
    });

    expect(getBrowserAnnotationAttachmentsSnapshot("conversation-1")).toHaveLength(1);
    expect(listener).toHaveBeenCalledOnce();
    removeBrowserAnnotationAttachment("conversation-1", "attachment-1");
    expect(getBrowserAnnotationAttachmentsSnapshot("conversation-1")).toEqual([]);
    unsubscribe();
  });

  test("validates attachments and retains a bounded newest-first window", () => {
    const makeAttachment = (index: number) => ({
      schemaVersion: 1 as const,
      id: `attachment-${index}`,
      browserTabId: "browser-tab-1",
      createdAt: index,
      note: "",
      pageTitle: "Example",
      pageUrl: "https://example.com/",
      anchors: [{
        id: `anchor-${index}`,
        kind: "region" as const,
        pageUrl: "https://example.com/",
        rect: { x: 1, y: 2, width: 10, height: 20 },
      }],
    });
    replaceBrowserAnnotationAttachments(
      "conversation-1",
      Array.from({ length: 35 }, (_, index) => makeAttachment(index)),
    );

    const retained = getBrowserAnnotationAttachmentsSnapshot("conversation-1");
    expect(retained).toHaveLength(32);
    expect(retained[0]?.id).toBe("attachment-3");
    expect(retained.at(-1)?.id).toBe("attachment-34");
    expect(() => publishBrowserAnnotationAttachment(
      "conversation-1",
      {
        ...makeAttachment(36),
        anchors: [],
      },
    )).toThrow();
  });
});
