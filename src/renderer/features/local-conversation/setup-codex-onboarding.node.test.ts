import { beforeEach, describe, expect, test } from "vitest";
import type { ProtocolAppInfo } from "@/lib/types";
import {
  clearPersistedAtomStoreForTests,
} from "@/lib/persisted-atom-store";
import {
  CODEX_SETUP_ROLE_IDS,
  resolveCodexSetupTaskSuggestions,
  shuffleCodexSetupRoles,
} from "./setup-codex-onboarding";
import {
  clearCodexSetupRoleStateCacheForTests,
  readCodexSetupRoleState,
  writeCodexSetupRoles,
} from "./setup-codex-role-state";
import {
  buildCodexSetupSelectedSourceIds,
  resolveCodexSetupFallbackSources,
} from "./setup-codex-context-sources";

function app(input: Partial<ProtocolAppInfo> & Pick<ProtocolAppInfo, "id" | "name">): ProtocolAppInfo {
  return {
    description: null,
    logoUrl: null,
    logoUrlDark: null,
    iconAssets: null,
    iconDarkAssets: null,
    distributionChannel: null,
    branding: null,
    appMetadata: null,
    labels: null,
    installUrl: null,
    isAccessible: true,
    isEnabled: true,
    pluginDisplayNames: [],
    ...input,
  };
}

describe("setup Codex onboarding model", () => {
  beforeEach(() => {
    clearPersistedAtomStoreForTests();
    clearCodexSetupRoleStateCacheForTests();
  });

  test("shuffles selectable roles once while keeping Something else last", () => {
    const roles = shuffleCodexSetupRoles(() => 0);
    expect(roles.length).toBe(CODEX_SETUP_ROLE_IDS.length);
    expect(roles.at(-1)).toBe("something_else");
    expect(new Set(roles).size).toBe(CODEX_SETUP_ROLE_IDS.length);
  });

  test("interleaves at most three task suggestions across normalized roles", () => {
    const suggestions = resolveCodexSetupTaskSuggestions([
      "engineering",
      "product_management",
    ]);
    expect(JSON.stringify(suggestions.map((suggestion) => suggestion.title))).toBe(JSON.stringify([
      "Debug an issue",
      "Review a PRD",
      "Plan implementation",
    ]));

    const fallback = resolveCodexSetupTaskSuggestions([]);
    expect(fallback[0]?.title).toBe("Summarize updates");
  });

  test("persists role state before the next task request reads it", async () => {
    await writeCodexSetupRoles(["engineering", "product_management"]);
    clearCodexSetupRoleStateCacheForTests();
    const state = await readCodexSetupRoleState();

    expect(JSON.stringify(state.roles)).toBe(JSON.stringify([
      "engineering",
      "product_management",
    ]));
    expect(state.personalizedSuggestionsEnabled).toBe(true);
    expect(state.workMode).toBe("coding");
  });

  test("resolves connected fallback aliases and preserves selected-source order", () => {
    const recommended = resolveCodexSetupFallbackSources([
      app({ id: "connector_google_drive", name: "Google Drive" }),
      app({ id: "chat", name: "Team Chat", pluginDisplayNames: ["Slack"] }),
      app({ id: "mail", name: "Gmail" }),
    ]);

    expect(JSON.stringify(recommended.map((source) => source.id))).toBe(JSON.stringify([
      "google-drive",
      "slack",
      "gmail",
    ]));
    expect(JSON.stringify(buildCodexSetupSelectedSourceIds(
      ["notion", "slack"],
      recommended,
    ))).toBe(JSON.stringify([
      "notion",
      "slack",
      "google-drive",
      "gmail",
    ]));
  });
});
