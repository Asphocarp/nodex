import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
  __resetCodexAppServerMessageBusForTests,
  subscribeCodexAppServerMessage,
} from "./app-server-message-bus";

let hostMessageListener: ((message: unknown) => void) | null = null;

mock.module("./local-conversation-deps", () => ({
  subscribeCodexHostMessages: (listener: (message: unknown) => void) => {
    hostMessageListener = listener;
    return () => {
      hostMessageListener = null;
    };
  },
  invoke: async () => null,
}));

async function loadHostBridgeModule() {
  return import(`./local-conversation-host-bridge?test=${Date.now()}`);
}

describe("local conversation host bridge", () => {
  beforeEach(() => {
    __resetCodexAppServerMessageBusForTests();
    hostMessageListener = null;
  });

  test("dispatches thread title updates onto the app-server message bus", async () => {
    const received: Array<{ conversationId: string; title: string }> = [];
    const unsubscribe = subscribeCodexAppServerMessage("thread-title-updated", (event) => {
      received.push({
        conversationId: event.conversationId,
        title: event.title,
      });
    });

    const { startLocalConversationHostBridge, __resetLocalConversationHostBridgeForTests } = await loadHostBridgeModule();
    const stop = startLocalConversationHostBridge();
    hostMessageListener?.({
      type: "threadTitleUpdated",
      hostId: "default",
      conversationId: "thread-1",
      title: "Backfill cached thread names",
    });

    expect(JSON.stringify(received)).toBe(JSON.stringify([
      {
        conversationId: "thread-1",
        title: "Backfill cached thread names",
      },
    ]));

    stop();
    unsubscribe();
    __resetLocalConversationHostBridgeForTests();
  });

  test("dispatches host errors onto the app-server message bus", async () => {
    const received: Array<{ message: string; detail?: string }> = [];
    const unsubscribe = subscribeCodexAppServerMessage("error", (event) => {
      received.push({
        message: event.message,
        detail: event.detail,
      });
    });

    const { startLocalConversationHostBridge, __resetLocalConversationHostBridgeForTests } = await loadHostBridgeModule();
    const stop = startLocalConversationHostBridge();
    hostMessageListener?.({
      type: "error",
      hostId: "default",
      message: "Could not generate thread title",
      detail: "boom",
    });

    expect(JSON.stringify(received)).toBe(JSON.stringify([
      {
        message: "Could not generate thread title",
        detail: "boom",
      },
    ]));

    stop();
    unsubscribe();
    __resetLocalConversationHostBridgeForTests();
  });

  test("dispatches deleted threads onto the app-server message bus", async () => {
    const received: string[] = [];
    const unsubscribe = subscribeCodexAppServerMessage("thread-deleted", (event) => {
      received.push(event.threadId);
    });

    const { startLocalConversationHostBridge, __resetLocalConversationHostBridgeForTests } = await loadHostBridgeModule();
    const stop = startLocalConversationHostBridge();
    hostMessageListener?.({
      type: "threadDeleted",
      hostId: "default",
      threadId: "thread-1",
    });

    expect(JSON.stringify(received)).toBe(JSON.stringify(["thread-1"]));

    stop();
    unsubscribe();
    __resetLocalConversationHostBridgeForTests();
  });
});
