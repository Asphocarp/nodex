import { describe, expect, test } from "vite-plus/test";
import { createBrowserUsePeerAuthorizer } from "./browser-use-peer-authorizer";

describe("createBrowserUsePeerAuthorizer", () => {
  test("allows the explicit disabled policy without loading an addon", () => {
    const authorize = createBrowserUsePeerAuthorizer({
      addonPath: null,
      mode: "disabled",
      platform: "darwin",
    });

    expect(authorize({} as never)).toEqual({ authorized: true });
  });

  test("fails closed when packaged authorization has no addon", () => {
    const authorize = createBrowserUsePeerAuthorizer({
      addonPath: null,
      mode: "packaged",
      platform: "darwin",
    });

    expect(authorize({} as never)).toEqual({
      authorized: false,
      reason: "peer-authorization-addon-unavailable",
    });
  });

  test("does not infer a bypass from development peer verification", () => {
    const authorize = createBrowserUsePeerAuthorizer({
      addonPath: null,
      mode: "development",
      platform: "darwin",
    });

    expect(authorize({} as never)).toEqual({
      authorized: false,
      reason: "peer-authorization-addon-unavailable",
    });
  });
});
