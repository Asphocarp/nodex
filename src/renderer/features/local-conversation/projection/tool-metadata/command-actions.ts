import type { CodexCommandAction, CodexTranscriptEntry } from "../../../../lib/types";

export interface ExplorationSkillPathInfo {
  skillId: string;
  skillName: string;
  isSkillDefinitionFile: boolean;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null) return null;
  return value as Record<string, unknown>;
}

function normalizeActionType(actionType: string): string {
  return actionType.replace(/[_\-\s]/g, "").toLowerCase();
}

export function parseCommandActions(value: unknown): CodexCommandAction[] {
  if (!Array.isArray(value)) return [];

  return value.reduce<CodexCommandAction[]>((acc, entry) => {
    const candidate = asRecord(entry);
    if (!candidate) return acc;

    const actionTypeRaw = typeof candidate.type === "string" ? candidate.type : null;
    if (!actionTypeRaw) return acc;
    const actionType = normalizeActionType(actionTypeRaw);

    const command = typeof candidate.command === "string"
      ? candidate.command
      : typeof candidate.cmd === "string"
        ? candidate.cmd
        : "";

    if (actionType === "read") {
      const name = typeof candidate.name === "string" ? candidate.name : "";
      const path = typeof candidate.path === "string" ? candidate.path : "";
      if (!name || !path) return acc;
      acc.push({ type: "read", command, name, path });
      return acc;
    }

    if (actionType === "listfiles") {
      acc.push({
        type: "listFiles",
        command,
        path: typeof candidate.path === "string" ? candidate.path : null,
      });
      return acc;
    }

    if (actionType === "search") {
      acc.push({
        type: "search",
        command,
        query: typeof candidate.query === "string" ? candidate.query : null,
        path: typeof candidate.path === "string" ? candidate.path : null,
      });
      return acc;
    }

    if (actionType === "unknown") {
      acc.push({ type: "unknown", command });
    }

    return acc;
  }, []);
}

export function extractCommandActions(item: Pick<CodexTranscriptEntry, "commandActions">): CodexCommandAction[] {
  return item.commandActions ?? [];
}

export function isExplorationAction(action: CodexCommandAction): boolean {
  return action.type === "read" || action.type === "listFiles" || action.type === "search";
}

export function normalizeExplorationPath(path: string | null | undefined): string | null {
  const trimmed = path?.trim();
  if (!trimmed) return null;

  const isAbsolute = trimmed.startsWith("/") || /^[A-Za-z]:[\\/]/.test(trimmed);
  const normalizedSegments: string[] = [];

  for (const segment of trimmed.replaceAll("\\", "/").split("/")) {
    if (segment.length === 0 || segment === ".") continue;
    if (segment === "..") {
      if (normalizedSegments.length > 0 && normalizedSegments[normalizedSegments.length - 1] !== "..") {
        normalizedSegments.pop();
        continue;
      }
      if (!isAbsolute) normalizedSegments.push(segment);
      continue;
    }
    normalizedSegments.push(segment);
  }

  const normalizedPath = normalizedSegments.join("/");
  if (isAbsolute) return normalizedPath.length > 0 ? `/${normalizedPath}` : "/";
  return normalizedPath.length > 0 ? normalizedPath : null;
}

export function resolveExplorationPath(path: string | null | undefined, cwd: string | null | undefined): string | null {
  const normalizedPath = normalizeExplorationPath(path);
  if (!normalizedPath) return null;
  if (normalizedPath.startsWith("/")) return normalizedPath;
  const normalizedCwd = normalizeExplorationPath(cwd);
  if (!normalizedCwd) return normalizedPath;
  return normalizeExplorationPath(`${normalizedCwd}/${normalizedPath}`);
}

function formatSkillName(value: string): string {
  return value
    .replaceAll("_", "-")
    .split("-")
    .filter((segment) => segment.length > 0)
    .map((segment) => `${segment[0]?.toUpperCase() ?? ""}${segment.slice(1)}`)
    .join(" ");
}

export function resolveExplorationSkillPathInfo(path: string | null | undefined): ExplorationSkillPathInfo | null {
  const normalizedPath = normalizeExplorationPath(path);
  if (!normalizedPath) return null;

  const segments = normalizedPath
    .replace(/^\/+/, "")
    .split("/")
    .filter((segment) => segment.length > 0);

  for (let index = 0; index < segments.length; index += 1) {
    const current = segments[index]?.toLowerCase();
    const next = segments[index + 1]?.toLowerCase();
    if ((current !== ".codex" && current !== ".agents") || next !== "skills") continue;

    const candidate = segments[index + 2] ?? null;
    const candidateLower = candidate?.toLowerCase();
    const skillNameIndex = candidateLower === "_import" || candidateLower === ".system" ? index + 3 : index + 2;
    const skillSegment = segments[skillNameIndex] ?? null;
    if (!skillSegment) continue;

    const remainingSegments = segments.slice(skillNameIndex + 1);
    return {
      skillId: skillSegment,
      skillName: formatSkillName(skillSegment),
      isSkillDefinitionFile: remainingSegments.length === 1 && remainingSegments[0]?.toLowerCase() === "skill.md",
    };
  }

  return null;
}
