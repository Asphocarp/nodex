import { describe, expect, test } from "vitest";
import type { SkillsListResponse } from "@nodex/codex-app-server-protocol/v2/SkillsListResponse";
import {
  buildComposerSkillInventory,
  hydrateComposerSkillInventoryIcons,
} from "./composer-skill-inventory";

describe("buildComposerSkillInventory", () => {
  test("keeps enabled skills in server order and deduplicates shared paths", () => {
    const response: SkillsListResponse = {
      data: [{
        cwd: "/repo/a",
        errors: [],
        skills: [{
          name: "Browser",
          description: "Long description",
          interface: {
            displayName: "Browser Use",
            shortDescription: "Control a browser",
            iconSmall: "/skills/browser/icon.svg",
            iconSmallUrl: null,
            iconLargeUrl: null,
            brandColor: "#4b8df8",
          },
          path: "/skills/browser/SKILL.md",
          scope: "user",
          enabled: true,
        }, {
          name: "Disabled",
          description: "Disabled",
          path: "/skills/disabled/SKILL.md",
          scope: "repo",
          enabled: false,
        }],
      }, {
        cwd: "/repo/b",
        errors: [],
        skills: [{
          name: "Duplicate",
          description: "Must not replace the first item",
          path: "/skills/browser/SKILL.md",
          scope: "repo",
          enabled: true,
        }, {
          name: "PDF",
          description: "Read PDFs",
          shortDescription: "PDF tools",
          path: "/skills/pdf/SKILL.md",
          scope: "system",
          enabled: true,
        }],
      }],
    };

    expect(buildComposerSkillInventory(response)).toEqual([{
      name: "Browser",
      displayName: "Browser Use",
      description: "Control a browser",
      iconUrl: null,
      brandColor: "#4b8df8",
      path: "/skills/browser/SKILL.md",
      scope: "user",
    }, {
      name: "PDF",
      displayName: "PDF",
      description: "PDF tools",
      iconUrl: null,
      brandColor: null,
      path: "/skills/pdf/SKILL.md",
      scope: "system",
    }]);
  });

  test("hydrates local skill icons without exposing filesystem paths", async () => {
    const response: SkillsListResponse = {
      data: [{
        cwd: "/repo",
        errors: [],
        skills: [{
          name: "Browser",
          description: "Control a browser",
          interface: {
            iconSmall: "/skills/browser/icon.svg",
            iconSmallUrl: null,
            iconLargeUrl: null,
            brandColor: "#4b8df8",
          },
          path: "/skills/browser/SKILL.md",
          scope: "system",
          enabled: true,
        }],
      }],
    };

    const inventory = await hydrateComposerSkillInventoryIcons(
      response,
      buildComposerSkillInventory(response),
      async (filePath) => new TextEncoder().encode(filePath),
    );

    expect(inventory).toEqual([{
      name: "Browser",
      displayName: "Browser",
      description: "Control a browser",
      iconUrl: `data:image/svg+xml;base64,${
        Buffer.from("/skills/browser/icon.svg").toString("base64")
      }`,
      brandColor: "#4b8df8",
      path: "/skills/browser/SKILL.md",
      scope: "system",
    }]);
  });
});
