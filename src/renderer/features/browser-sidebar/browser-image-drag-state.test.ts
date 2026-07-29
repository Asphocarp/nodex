import { afterEach, describe, expect, test, vi } from "vitest";
import {
  clearBrowserImageDragState,
  getBrowserImageDragSnapshot,
  publishBrowserImageDragState,
  subscribeBrowserImageDragState,
} from "./browser-image-drag-state";

const attachmentConversationId = "thread-1";
const identity = {
  browserConversationId: "session-1",
  browserViewScopeId: "window-1",
  browserTabId: "browser-1",
} as const;

afterEach(() => {
  clearBrowserImageDragState(attachmentConversationId);
});

describe("browser image drag state", () => {
  test("routes one active Browser image drag to the matching composer", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeBrowserImageDragState(listener);
    publishBrowserImageDragState(attachmentConversationId, {
      ...identity,
      isActive: true,
    });

    expect(getBrowserImageDragSnapshot(attachmentConversationId)).toEqual({
      ...identity,
      attachmentConversationId,
    });
    expect(getBrowserImageDragSnapshot("another-thread")).toBeNull();
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  test("ignores a stale drag-end from another Browser tab", () => {
    publishBrowserImageDragState(attachmentConversationId, {
      ...identity,
      isActive: true,
    });
    publishBrowserImageDragState(attachmentConversationId, {
      ...identity,
      browserTabId: "stale-browser",
      isActive: false,
    });
    expect(getBrowserImageDragSnapshot(attachmentConversationId)).toEqual({
      ...identity,
      attachmentConversationId,
    });

    publishBrowserImageDragState(attachmentConversationId, {
      ...identity,
      isActive: false,
    });
    expect(getBrowserImageDragSnapshot(attachmentConversationId)).toBeNull();
  });
});
