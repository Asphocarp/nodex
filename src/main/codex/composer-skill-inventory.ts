import type { SkillsListResponse } from "@nodex/codex-app-server-protocol/v2/SkillsListResponse";
import type { CodexComposerSkill } from "../../shared/types";
import {
  loadComposerInventoryIconDataUrl,
  type ComposerInventoryIconLoader,
} from "./composer-inventory-icon";

function normalizeOptionalText(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized || null;
}

export function buildComposerSkillInventory(
  response: SkillsListResponse,
): CodexComposerSkill[] {
  const skillsByPath = new Map<string, CodexComposerSkill>();
  for (const entry of response.data) {
    for (const skill of entry.skills) {
      if (!skill.enabled) continue;
      const skillPath = skill.path.trim();
      const name = skill.name.trim();
      if (!skillPath || !name || skillsByPath.has(skillPath)) continue;
      skillsByPath.set(skillPath, {
        name,
        displayName: skill.interface?.displayName?.trim() || name,
        description:
          skill.interface?.shortDescription?.trim()
          || skill.shortDescription?.trim()
          || skill.description.trim(),
        iconUrl: null,
        brandColor: normalizeOptionalText(skill.interface?.brandColor),
        path: skillPath,
        scope: skill.scope,
      });
    }
  }
  return Array.from(skillsByPath.values());
}

export async function hydrateComposerSkillInventoryIcons(
  response: SkillsListResponse,
  skills: readonly CodexComposerSkill[],
  loadIcon?: ComposerInventoryIconLoader,
): Promise<CodexComposerSkill[]> {
  const iconPathsBySkillPath = new Map(
    response.data.flatMap((entry) =>
      entry.skills.flatMap((skill) =>
        skill.interface?.iconSmall
          ? [[skill.path.trim(), skill.interface.iconSmall] as const]
          : []
      )
    ),
  );
  return Promise.all(skills.map(async (skill) => {
    const iconUrl = await loadComposerInventoryIconDataUrl(
      iconPathsBySkillPath.get(skill.path),
      loadIcon,
    );
    return iconUrl ? { ...skill, iconUrl } : skill;
  }));
}
