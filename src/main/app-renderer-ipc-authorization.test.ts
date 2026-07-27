import { describe, expect, test } from "vitest";
import { isTrustedAppRendererIpcSender } from "./app-renderer-ipc-authorization";

describe("isTrustedAppRendererIpcSender", () => {
  test("accepts only the top-level frame of an owned app window", () => {
    expect(isTrustedAppRendererIpcSender({
      hasOwnerWindow: true,
      senderType: "window",
      isMainFrame: true,
    })).toBe(true);
  });

  test.each([
    {
      hasOwnerWindow: false,
      senderType: "window",
      isMainFrame: true,
    },
    {
      hasOwnerWindow: true,
      senderType: "webview",
      isMainFrame: true,
    },
    {
      hasOwnerWindow: true,
      senderType: "window",
      isMainFrame: false,
    },
  ])("rejects an untrusted sender: %o", (facts) => {
    expect(isTrustedAppRendererIpcSender(facts)).toBe(false);
  });
});
