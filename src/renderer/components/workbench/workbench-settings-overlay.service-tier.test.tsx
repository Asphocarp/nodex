import { describe, expect, test } from "bun:test";
import { fireEvent } from "@testing-library/react";
import { AppProviders } from "@/app-providers";
import { makeDefaultSidebarTopLevelSectionsPrefs } from "@/lib/sidebar-section-prefs";
import { render, settleAsyncRender } from "@/test/dom";
import { installWindowApi } from "@/test/browser-globals";
import { __resetWindowRestoreSettingsForTests } from "@/lib/use-window-restore-settings";
import { __resetThreadNotificationSettingsForTests } from "@/lib/use-thread-notification-settings";
import { SettingsRouteShell } from "./workbench-settings-overlay";
import { buildSettingsPath } from "./workbench-settings-routes";

const PROJECTS = [
  {
    id: "default",
    name: "Nodex",
    description: "",
    workspacePath: "/Users/asc/repo/nodex",
    created: new Date("2026-03-01T00:00:00.000Z"),
  },
];

const storageMap = new Map<string, string>();

const mockStorage = {
  getItem(key: string): string | null {
    return storageMap.has(key) ? storageMap.get(key) ?? null : null;
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
const invokedChannels: Array<{ channel: string; args: unknown[] }> = [];

function resetStorage(): void {
  storageMap.clear();
  invokedChannels.splice(0);
  __resetWindowRestoreSettingsForTests();
  __resetThreadNotificationSettingsForTests();
  localStorageRef.removeItem("nodex-codex-default-service-tier-v1");
}

function installSettingsWindowApi() {
  installWindowApi({
    invoke: async (channel: string, ...args: unknown[]) => {
      invokedChannels.push({ channel, args });
      switch (channel) {
        case "settings:thread-notifications:get":
          return {
            turnMode: "unfocused",
            permissionsEnabled: true,
            questionsEnabled: true,
          };
        case "settings:app-updates:get":
          return { automaticChecksEnabled: true };
        case "settings:window-restore:get":
          return { policy: "all" };
        case "settings:window-restore:update":
          return args[0];
        case "app:update:status":
          return {
            status: "idle",
            supported: true,
            currentVersion: "0.1.0",
            availableVersion: null,
            releaseName: null,
            releaseDate: null,
            releaseNotes: null,
            progressPercent: null,
            transferredBytes: null,
            totalBytes: null,
            checkedAt: null,
            message: null,
          };
        case "worktrees:managed:list":
          return [];
        default:
          return null;
      }
    },
    on: () => () => {},
  });
}

function renderOverlay({
  path = buildSettingsPath("general-settings"),
  onBackToApp = () => {},
}: {
  path?: string;
  onBackToApp?: () => void;
} = {}) {
  return render(
    <AppProviders>
      <SettingsRouteShell
        path={path}
        onPathChange={() => {}}
        onBackToApp={onBackToApp}
        onRequestProjectPickerOpen={() => {}}
        projects={PROJECTS}
        activeProjectId="default"
        sidebarTopLevelSectionOrder={["recents", "cards", "threads", "files"]}
        sidebarTopLevelSections={makeDefaultSidebarTopLevelSectionsPrefs()}
        onSidebarTopLevelSectionVisibleChange={() => {}}
        threadQueueFollowUpsEnabled={false}
        onThreadQueueFollowUpsEnabledChange={() => {}}
        composerEnterBehavior="enter"
        onComposerEnterBehaviorChange={() => {}}
        worktreeStartMode="autoBranch"
        onWorktreeStartModeChange={() => {}}
        worktreeAutoBranchPrefix="codex/"
        onWorktreeAutoBranchPrefixChange={() => {}}
        smartPrefixParsingEnabled={true}
        onSmartPrefixParsingEnabledChange={() => {}}
        stripSmartPrefixFromTitleEnabled={true}
        onStripSmartPrefixFromTitleEnabledChange={() => {}}
      />
    </AppProviders>,
  );
}

describe("SettingsRouteShell service tier", () => {
  test("reads the stored tier and writes Standard/Fast through the shared setting", async () => {
    resetStorage();
    localStorageRef.setItem("nodex-codex-default-service-tier-v1", "fast");
    installSettingsWindowApi();

    const view = renderOverlay();
    await settleAsyncRender();

    const fastButton = view.getByRole("button", { name: "Fast" });
    const standardButton = view.getByRole("button", { name: "Standard" });

    expect(fastButton.getAttribute("aria-pressed")).toBe("true");
    expect(standardButton.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(standardButton);
    await settleAsyncRender();

    expect(localStorageRef.getItem("nodex-codex-default-service-tier-v1")).toBe(null);
    expect(standardButton.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(fastButton);
    await settleAsyncRender();

    expect(localStorageRef.getItem("nodex-codex-default-service-tier-v1")).toBe("fast");
    expect(fastButton.getAttribute("aria-pressed")).toBe("true");
  });

  test("backs out on Escape unless focus is inside an editable setting", async () => {
    resetStorage();
    installSettingsWindowApi();
    let backCalls = 0;

    const view = renderOverlay({
      path: buildSettingsPath("worktrees"),
      onBackToApp: () => {
        backCalls += 1;
      },
    });
    await settleAsyncRender();

    const autoBranchPrefixInput = view.getByLabelText("Auto branch prefix");
    autoBranchPrefixInput.focus();
    fireEvent.keyDown(window, { key: "Escape" });
    await settleAsyncRender();

    expect(backCalls).toBe(0);

    autoBranchPrefixInput.blur();
    fireEvent.keyDown(window, { key: "Escape" });
    await settleAsyncRender();

    expect(backCalls).toBe(1);
  });

});
