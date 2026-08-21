import { StrictMode, createElement } from "react";
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DesktopNotificationPermissionBootstrap,
  bootstrapDesktopNotificationPermission,
  resetDesktopNotificationPermissionBootstrapForTests,
} from "./desktop-notification-permission-bootstrap";

beforeEach(() => {
  resetDesktopNotificationPermissionBootstrapForTests();
});

describe("desktop notification permission bootstrap", () => {
  it("reports a missing browser API without requesting permission", async () => {
    const logger = { debug: vi.fn(), warn: vi.fn() };
    await expect(bootstrapDesktopNotificationPermission(null, logger)).resolves.toBeNull();
    expect(logger.debug).toHaveBeenCalledWith(
      "[desktop-notifications] browser permission API missing",
    );
  });

  it.each(["granted", "denied"] as const)("returns an existing %s decision", async (permission) => {
    const requestPermission = vi.fn(async () => permission);
    await expect(
      bootstrapDesktopNotificationPermission(
        {
          permission,
          requestPermission,
        },
        { debug: vi.fn(), warn: vi.fn() },
      ),
    ).resolves.toBe(permission);
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it("requests a default permission once per constructor identity", async () => {
    const api = {
      permission: "default" as const,
      requestPermission: vi.fn(async () => "granted" as const),
    };
    const logger = { debug: vi.fn(), warn: vi.fn() };
    await bootstrapDesktopNotificationPermission(api, logger);
    await bootstrapDesktopNotificationPermission(api, logger);
    expect(api.requestPermission).toHaveBeenCalledOnce();
  });

  it("deduplicates StrictMode effect replay", () => {
    const originalNotification = globalThis.Notification;
    const requestPermission = vi.fn(async () => "granted" as const);
    class TestNotification {
      static permission = "default" as const;
      static requestPermission = requestPermission;
    }
    Object.defineProperty(globalThis, "Notification", {
      configurable: true,
      value: TestNotification,
    });
    try {
      render(
        createElement(StrictMode, null, createElement(DesktopNotificationPermissionBootstrap)),
      );
      expect(requestPermission).toHaveBeenCalledOnce();
    } finally {
      Object.defineProperty(globalThis, "Notification", {
        configurable: true,
        value: originalNotification,
      });
    }
  });

  it("logs request failure and returns null", async () => {
    const error = new Error("permission failed");
    const logger = { debug: vi.fn(), warn: vi.fn() };
    await expect(
      bootstrapDesktopNotificationPermission(
        {
          permission: "default",
          requestPermission: vi.fn(async () => {
            throw error;
          }),
        },
        logger,
      ),
    ).resolves.toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(
      "[desktop-notifications] browser permission request failed",
      { error },
    );
  });
});
