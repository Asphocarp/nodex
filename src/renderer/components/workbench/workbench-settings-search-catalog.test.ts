import { describe, expect, test } from "vitest";
import {
  buildSettingsSearchResults,
  buildSettingsSearchTargets,
  type SettingsSearchContext,
} from "@/lib/settings-search";
import {
  SETTINGS_SECTIONS,
  type SettingsSectionId,
} from "./workbench-settings-sections";

const SEARCH_CONTEXT: SettingsSearchContext = {
  activeProjectName: "Nodex Workspace",
  projectNames: ["Nodex Workspace", "Docs Space"],
};

const VISIBLE_SECTION_IDS = SETTINGS_SECTIONS.map((section) => section.id);

function searchCatalog(query: string, context: SettingsSearchContext = SEARCH_CONTEXT) {
  return buildSettingsSearchResults({
    query,
    targets: buildSettingsSearchTargets(SETTINGS_SECTIONS, context),
    visibleSectionIds: VISIBLE_SECTION_IDS,
  });
}

function hasSectionResult(query: string, sectionId: SettingsSectionId): boolean {
  return searchCatalog(query).some((result) => result.sectionId === sectionId);
}

describe("workbench settings search catalog", () => {
  test("every visible settings section has a populated search catalog", () => {
    for (const section of SETTINGS_SECTIONS) {
      expect(section.searchMessages.length > 0).toBe(true);
    }
  });

  test("indexes setting row descriptions and option labels across panels", () => {
    expect(hasSectionResult("masked session replays", "general-settings")).toBe(true);
    expect(hasSectionResult("force fixed theme", "appearance")).toBe(true);
    expect(hasSectionResult("danger-full-access", "agent")).toBe(true);
    expect(hasSectionResult("materialize inflating note", "editor")).toBe(true);
    expect(hasSectionResult("more-properties toggle", "card")).toBe(true);
    expect(hasSectionResult("auto-create branch detached", "worktrees")).toBe(true);
    expect(hasSectionResult("CODEX_SOURCE_TREE_PATH", "local-environments")).toBe(true);
    expect(hasSectionResult("pruning unlimited", "backups")).toBe(true);
  });

  test("uses runtime project names as hidden local-environment terms", () => {
    const results = searchCatalog("Docs Space");

    expect(results.length).toBe(1);
    expect(results[0]?.sectionId).toBe("local-environments");
    expect(results[0]?.label).toBe("Local environments");
  });
});
