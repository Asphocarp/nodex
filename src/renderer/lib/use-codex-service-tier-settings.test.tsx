import { describe, expect, test } from "vite-plus/test";
import { act } from "@testing-library/react";
import { createElement } from "react";
import { render, settleAsyncRender, textContent } from "../test/dom";
import {
  CODEX_DEFAULT_SERVICE_TIER_STORAGE_KEY,
  writeCodexServiceTier,
} from "./codex-service-tier-settings";
import {
  CodexServiceTierSettingsProvider,
  useCodexServiceTierSettings,
} from "./use-codex-service-tier-settings";

const storageMap = new Map<string, string>();

const mockStorage = {
  getItem(key: string): string | null {
    return storageMap.has(key) ? (storageMap.get(key) ?? null) : null;
  },
  setItem(key: string, value: string): void {
    storageMap.set(key, value);
  },
  removeItem(key: string): void {
    storageMap.delete(key);
  },
};

if (!(globalThis as { localStorage?: unknown }).localStorage) {
  (globalThis as { localStorage: typeof mockStorage }).localStorage = mockStorage;
}

const localStorageRef = (globalThis as { localStorage: typeof mockStorage }).localStorage;

function resetStorage(): void {
  storageMap.clear();
  localStorageRef.removeItem(CODEX_DEFAULT_SERVICE_TIER_STORAGE_KEY);
}

function Probe() {
  const { serviceTierSettings, setServiceTier } = useCodexServiceTierSettings();

  return createElement(
    "div",
    null,
    createElement(
      "div",
      { "data-service-tier": serviceTierSettings.serviceTier ?? "standard" },
      serviceTierSettings.serviceTier ?? "standard",
    ),
    createElement(
      "button",
      {
        type: "button",
        onClick: () => setServiceTier("fast", "settings"),
      },
      "Enable fast",
    ),
  );
}

describe("use-codex-service-tier-settings", () => {
  test("writes through the shared setter", async () => {
    resetStorage();

    const view = render(
      <CodexServiceTierSettingsProvider>
        <Probe />
      </CodexServiceTierSettingsProvider>,
    );
    await settleAsyncRender();

    expect(textContent(view.container.querySelector("[data-service-tier]") as HTMLElement)).toBe(
      "standard",
    );

    await act(async () => {
      (view.getByText("Enable fast") as HTMLButtonElement).click();
    });
    await settleAsyncRender();

    expect(textContent(view.container.querySelector("[data-service-tier]") as HTMLElement)).toBe(
      "fast",
    );
    expect(localStorageRef.getItem(CODEX_DEFAULT_SERVICE_TIER_STORAGE_KEY)).toBe("fast");
  });

  test("reacts to cross-window storage updates", async () => {
    resetStorage();

    const view = render(
      <CodexServiceTierSettingsProvider>
        <Probe />
      </CodexServiceTierSettingsProvider>,
    );
    await settleAsyncRender();

    expect(textContent(view.container.querySelector("[data-service-tier]") as HTMLElement)).toBe(
      "standard",
    );

    await act(async () => {
      writeCodexServiceTier("fast");
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: CODEX_DEFAULT_SERVICE_TIER_STORAGE_KEY,
          newValue: "fast",
        }),
      );
    });
    await settleAsyncRender();

    expect(textContent(view.container.querySelector("[data-service-tier]") as HTMLElement)).toBe(
      "fast",
    );
  });
});
