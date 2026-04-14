import { describe, expect, test } from "bun:test";
import { fireEvent } from "@testing-library/react";
import { AppProviders } from "@/app-providers";
import { makeDefaultSidebarTopLevelSectionsPrefs } from "@/lib/sidebar-section-prefs";
import { render, settleAsyncRender } from "@/test/dom";
import { installWindowApi } from "@/test/browser-globals";
import type { BackupRecord } from "@/lib/types";
import { SettingsOverlay } from "./workbench-settings-overlay";
import { buildSettingsPath } from "./workbench-settings-routes";

const PROJECTS = [
  {
    id: "default",
    name: "Nodex",
    description: "",
    workspacePath: "/Users/asc/repo/nodex2",
    created: new Date("2026-03-01T00:00:00.000Z"),
  },
];

function renderOverlay() {
  return render(
    <AppProviders>
      <SettingsOverlay
        open={true}
        onOpenChange={() => {}}
        path={buildSettingsPath("backups")}
        onPathChange={() => {}}
        onRequestProjectPickerOpen={() => {}}
        projects={PROJECTS}
        activeProjectId="default"
        sidebarTopLevelSectionOrder={["recents", "cards", "threads", "files"]}
        sidebarTopLevelSections={makeDefaultSidebarTopLevelSectionsPrefs()}
        onSidebarTopLevelSectionVisibleChange={() => {}}
        stageRailLayoutMode="sliding-window"
        onStageRailLayoutModeChange={() => {}}
        nextPanelPeekPx={32}
        onNextPanelPeekPxChange={() => {}}
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

describe("SettingsOverlay backups", () => {
  test("deletes a snapshot through inline row confirmation", async () => {
    const backups: BackupRecord[] = [
      {
        version: 1,
        id: "backup-1",
        createdAt: "2026-04-15T10:00:00.000Z",
        trigger: "manual",
        label: "Before risky change",
        includesAssets: true,
        dbBytes: 1024,
        assetsBytes: 512,
        totalBytes: 1536,
      },
    ];
    const deletedBackupIds: string[] = [];

    installWindowApi({
      invoke: async (channel: string, ...args: unknown[]) => {
        switch (channel) {
          case "settings:backup:get":
            return {
              autoEnabled: false,
              intervalHours: 24,
              retentionCount: 10,
              envOverrides: {
                autoEnabled: false,
                intervalHours: false,
                retentionCount: false,
              },
            };
          case "settings:history:get":
            return {
              retentionCount: 1000,
              envOverrides: {
                retentionCount: false,
              },
            };
          case "backup:list":
            return [...backups];
          case "backup:delete": {
            const [backupId] = args as [string];
            deletedBackupIds.push(backupId);
            const index = backups.findIndex((backup) => backup.id === backupId);
            if (index >= 0) {
              backups.splice(index, 1);
            }
            return {
              success: true,
              deletedBackupId: backupId,
            };
          }
          default:
            return null;
        }
      },
      on: () => () => {},
    });

    const view = renderOverlay();
    await settleAsyncRender();

    fireEvent.click(view.getByRole("button", { name: "Delete snapshot Before risky change" }));
    await settleAsyncRender();

    view.getByRole("button", { name: "Confirm delete" });
    view.getByRole("button", { name: "Cancel" });

    fireEvent.click(view.getByRole("button", { name: "Confirm delete" }));
    await settleAsyncRender();

    expect(deletedBackupIds.length).toBe(1);
    expect(deletedBackupIds[0]).toBe("backup-1");
    expect(view.queryByText("Before risky change")).toBe(null);
    view.getByText("Snapshot deleted.");
  });
});
