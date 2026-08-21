import { describe, expect, test } from "vite-plus/test";
import {
  BROWSER_USE_PEER_AUTHORIZATION_ENV,
  resolveBrowserUseHostCapability,
} from "./browser-use-host-capability";

describe("resolveBrowserUseHostCapability", () => {
  test("enables the packaged macOS host with production peer authorization", () => {
    expect(
      resolveBrowserUseHostCapability({
        browserRuntimeStatus: "available",
        environment: {},
        isPackaged: true,
        platform: "darwin",
      }),
    ).toEqual({
      availableBackends: ["iab"],
      peerAuthorizationMode: "packaged",
      status: "available",
    });
  });

  test("keeps development peer verification separate from unpackaged host availability", () => {
    expect(
      resolveBrowserUseHostCapability({
        browserRuntimeStatus: "available",
        environment: {
          [BROWSER_USE_PEER_AUTHORIZATION_ENV]: "1",
        },
        isPackaged: false,
        platform: "darwin",
      }),
    ).toEqual({
      availableBackends: ["iab"],
      peerAuthorizationMode: "development",
      status: "available",
    });

    expect(
      resolveBrowserUseHostCapability({
        browserRuntimeStatus: "available",
        environment: {},
        isPackaged: false,
        platform: "darwin",
      }),
    ).toEqual({
      availableBackends: ["iab"],
      peerAuthorizationMode: "disabled",
      status: "available",
    });
  });

  test("fails closed when the runtime or platform is unsupported", () => {
    expect(
      resolveBrowserUseHostCapability({
        browserRuntimeStatus: "unavailable",
        environment: {
          [BROWSER_USE_PEER_AUTHORIZATION_ENV]: "1",
        },
        isPackaged: false,
        platform: "darwin",
      }),
    ).toMatchObject({
      reason: "runtime-unavailable",
      status: "unavailable",
    });
    expect(
      resolveBrowserUseHostCapability({
        browserRuntimeStatus: "available",
        environment: {
          [BROWSER_USE_PEER_AUTHORIZATION_ENV]: "1",
        },
        isPackaged: false,
        platform: "linux",
      }),
    ).toMatchObject({
      reason: "platform-unsupported",
      status: "unavailable",
    });
  });
});
