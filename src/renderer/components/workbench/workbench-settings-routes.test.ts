import { describe, expect, test } from "bun:test";
import {
  buildSettingsPath,
  parseSettingsPath,
  resolveSettingsShellState,
} from "./workbench-settings-routes";

describe("workbench settings routes", () => {
  test("builds canonical settings paths", () => {
    expect(buildSettingsPath("general-settings")).toBe("/settings/general-settings");
    expect(buildSettingsPath("keyboard-shortcuts")).toBe("/settings/keyboard-shortcuts");
    expect(buildSettingsPath("local-environments")).toBe("/settings/local-environments");
  });

  test("parses canonical settings paths", () => {
    expect(parseSettingsPath("/settings/general-settings")).toBe("general-settings");
    expect(parseSettingsPath("/settings/keyboard-shortcuts")).toBe("keyboard-shortcuts");
    expect(parseSettingsPath("/settings/local-environments")).toBe("local-environments");
    expect(parseSettingsPath("/settings")).toBe(null);
    expect(parseSettingsPath("/not-settings")).toBe(null);
  });

  test("ignores query strings and hashes when parsing settings paths", () => {
    expect(parseSettingsPath("/settings/general-settings?panel=updates")).toBe("general-settings");
    expect(parseSettingsPath("/settings/local-environments#project-alpha")).toBe("local-environments");
    expect(resolveSettingsShellState("/settings/backups?restore=latest#snapshots").activeSectionId).toBe("backups");
  });

  test("redirects the settings root to the default visible section", () => {
    const resolved = resolveSettingsShellState("/settings");
    expect(resolved.activeSectionId).toBe("general-settings");
    expect(resolved.redirectPath).toBe("/settings/general-settings");
  });

  test("redirects invalid settings slugs to the default visible section", () => {
    const resolved = resolveSettingsShellState("/settings/not-real");
    expect(resolved.activeSectionId).toBe("general-settings");
    expect(resolved.redirectPath).toBe("/settings/general-settings");
  });

  test("keeps canonical paths stable when the section exists", () => {
    const resolved = resolveSettingsShellState("/settings/worktrees");
    expect(resolved.activeSectionId).toBe("worktrees");
    expect(resolved.redirectPath).toBe(null);
  });
});
