import { describe, expect, test } from "vitest";
import { isTrustedWorkspaceFileIpcSender } from "./workspace-file-ipc-authorization";

describe("isTrustedWorkspaceFileIpcSender", () => {
  test("accepts only the top-level frame of an owned app window", () => {
    expect(isTrustedWorkspaceFileIpcSender({
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
    expect(isTrustedWorkspaceFileIpcSender(facts)).toBe(false);
  });
});
