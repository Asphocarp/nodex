import { describe, expect, test } from "bun:test";
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
      expect(section.searchMessages.length > 0).toBeTrue();
    }
  });

  test("indexes setting row descriptions and option labels across panels", () => {
    expect(hasSectionResult("masked session replays", "general-settings")).toBeTrue();
    expect(hasSectionResult("force fixed theme", "appearance")).toBeTrue();
    expect(hasSectionResult("danger-full-access", "agent")).toBeTrue();
    expect(hasSectionResult("materialize inflating note", "editor")).toBeTrue();
    expect(hasSectionResult("more-properties toggle", "card")).toBeTrue();
    expect(hasSectionResult("auto-create branch detached", "worktrees")).toBeTrue();
    expect(hasSectionResult("CODEX_SOURCE_TREE_PATH", "local-environments")).toBeTrue();
    expect(hasSectionResult("pruning unlimited", "backups")).toBeTrue();
  });

  test("uses runtime project names as hidden local-environment terms", () => {
    const results = searchCatalog("Docs Space");

    expect(results.length).toBe(1);
    expect(results[0]?.sectionId).toBe("local-environments");
    expect(results[0]?.label).toBe("Local environments");
  });
});
