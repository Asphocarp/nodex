import { describe, expect, test } from "vite-plus/test";
import { shouldGrantAppRendererPermission } from "./renderer-permissions";

describe("app renderer permissions", () => {
  test("allows clipboard writes only from a top-level app window", () => {
    expect(
      shouldGrantAppRendererPermission({
        permission: "clipboard-sanitized-write",
        webContentsType: "window",
        isMainFrame: true,
      }),
    ).toBe(true);
    expect(
      shouldGrantAppRendererPermission({
        permission: "clipboard-sanitized-write",
        webContentsType: "window",
        isMainFrame: false,
      }),
    ).toBe(false);
    expect(
      shouldGrantAppRendererPermission({
        permission: "clipboard-sanitized-write",
        webContentsType: "webview",
        isMainFrame: true,
      }),
    ).toBe(false);
  });

  test("preserves media access and rejects unrelated permissions", () => {
    expect(
      shouldGrantAppRendererPermission({
        permission: "media",
        webContentsType: "webview",
        isMainFrame: false,
      }),
    ).toBe(true);
    expect(
      shouldGrantAppRendererPermission({
        permission: "geolocation",
        webContentsType: "window",
        isMainFrame: true,
      }),
    ).toBe(false);
  });
});
