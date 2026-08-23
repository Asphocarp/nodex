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

  test("allows microphone access only from an owned top-level app renderer", () => {
    expect(
      shouldGrantAppRendererPermission({
        permission: "media",
        webContentsType: "window",
        isMainFrame: true,
        hasOwnerWindow: true,
        requestingOrigin: "app://-",
        requestedMediaTypes: ["audio"],
      }),
    ).toBe(true);
  });

  test("allows microphone access only from the exact configured development origin", () => {
    const request = {
      developmentOrigin: "http://localhost:51284",
      hasOwnerWindow: true,
      isMainFrame: true,
      permission: "media",
      requestedMediaTypes: ["audio"],
      webContentsType: "window",
    } as const;

    expect(
      shouldGrantAppRendererPermission({
        ...request,
        requestingOrigin: "http://localhost:51284/thread/1",
      }),
    ).toBe(true);
    expect(
      shouldGrantAppRendererPermission({
        ...request,
        requestingOrigin: "http://localhost:51285/thread/1",
      }),
    ).toBe(false);
  });

  test.each([
    { label: "camera", requestedMediaTypes: ["video"] },
    { label: "audio and camera", requestedMediaTypes: ["audio", "video"] },
    { label: "unknown media", requestedMediaTypes: ["unknown"] },
    { label: "missing media details", requestedMediaTypes: undefined },
  ])("rejects $label media access", ({ requestedMediaTypes }) => {
    expect(
      shouldGrantAppRendererPermission({
        permission: "media",
        webContentsType: "window",
        isMainFrame: true,
        hasOwnerWindow: true,
        requestingOrigin: "app://-",
        requestedMediaTypes,
      }),
    ).toBe(false);
  });

  test.each([
    { label: "subframe", isMainFrame: false },
    { label: "guest", webContentsType: "webview" },
    { label: "unowned window", hasOwnerWindow: false },
    { label: "cross-origin window", requestingOrigin: "https://example.com" },
  ])("rejects microphone access from a $label", (overrides) => {
    expect(
      shouldGrantAppRendererPermission({
        permission: "media",
        webContentsType: "window",
        isMainFrame: true,
        hasOwnerWindow: true,
        requestingOrigin: "app://-",
        requestedMediaTypes: ["audio"],
        ...overrides,
      }),
    ).toBe(false);
  });

  test("rejects unrelated permissions", () => {
    expect(
      shouldGrantAppRendererPermission({
        permission: "geolocation",
        webContentsType: "window",
        isMainFrame: true,
      }),
    ).toBe(false);
  });
});
