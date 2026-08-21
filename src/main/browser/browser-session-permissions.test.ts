import { describe, expect, test } from "vitest";
import { shouldGrantBrowserPermission } from "./browser-session-permissions";

describe("Browser Profile permission policy", () => {
  test("allows only sanitized clipboard writes from the top frame", () => {
    expect(
      shouldGrantBrowserPermission({
        permission: "clipboard-sanitized-write",
        isMainFrame: true,
      }),
    ).toBe(true);
    expect(
      shouldGrantBrowserPermission({
        permission: "clipboard-sanitized-write",
        isMainFrame: false,
      }),
    ).toBe(false);
    expect(
      shouldGrantBrowserPermission({
        permission: "media",
        isMainFrame: true,
      }),
    ).toBe(false);
  });
});
