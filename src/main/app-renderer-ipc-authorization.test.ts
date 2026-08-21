import { describe, expect, test } from "vite-plus/test";
import { isTrustedAppRendererIpcSender } from "./app-renderer-ipc-authorization";

describe("isTrustedAppRendererIpcSender", () => {
  test("accepts only the top-level frame of an owned app window", () => {
    expect(
      isTrustedAppRendererIpcSender({
        hasOwnerWindow: true,
        senderType: "window",
        senderUrl: "app://-/index.html",
        isMainFrame: true,
      }),
    ).toBe(true);
  });

  test.each([
    {
      hasOwnerWindow: false,
      senderType: "window",
      senderUrl: "app://-/index.html",
      isMainFrame: true,
    },
    {
      hasOwnerWindow: true,
      senderType: "webview",
      senderUrl: "app://-/index.html",
      isMainFrame: true,
    },
    {
      hasOwnerWindow: true,
      senderType: "window",
      senderUrl: "app://-/index.html",
      isMainFrame: false,
    },
    {
      hasOwnerWindow: true,
      senderType: "window",
      senderUrl: "app:///index.html",
      isMainFrame: true,
    },
    {
      hasOwnerWindow: true,
      senderType: "window",
      senderUrl: "https://example.com/",
      isMainFrame: true,
    },
  ])("rejects an untrusted sender: %o", (facts) => {
    expect(isTrustedAppRendererIpcSender(facts)).toBe(false);
  });

  test("accepts only the exact configured development origin", () => {
    expect(
      isTrustedAppRendererIpcSender({
        developmentOrigin: "http://localhost:51284",
        hasOwnerWindow: true,
        senderType: "window",
        senderUrl: "http://localhost:51284/thread/1",
        isMainFrame: true,
      }),
    ).toBe(true);
    expect(
      isTrustedAppRendererIpcSender({
        developmentOrigin: "http://localhost:51284",
        hasOwnerWindow: true,
        senderType: "window",
        senderUrl: "http://localhost:51285/thread/1",
        isMainFrame: true,
      }),
    ).toBe(false);
  });
});
