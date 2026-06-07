import type { Project } from "./types";

export interface NewChatProjectSelectorOption {
  id: string;
  label: string;
  description: string | null;
  workspacePath: string | null;
  searchText: string;
}

function normalizeSearchText(value: string): string {
  return value.trim().toLowerCase();
}

export function formatNewChatProjectSelectorOption(project: Project): NewChatProjectSelectorOption {
  const label = project.name.trim() || project.id;
  const description = project.workspacePath?.trim() || project.description.trim() || null;
  const workspacePath = project.workspacePath?.trim() || null;
  const searchText = normalizeSearchText([
    project.id,
    project.name,
    project.description,
    workspacePath ?? "",
  ].join(" "));

  return {
    id: project.id,
    label,
    description,
    workspacePath,
    searchText,
  };
}

export function buildNewChatProjectSelectorOptions(
  projects: readonly Project[],
): NewChatProjectSelectorOption[] {
  return projects.map(formatNewChatProjectSelectorOption);
}

export function filterNewChatProjectSelectorOptions(
  options: readonly NewChatProjectSelectorOption[],
  search: string,
): NewChatProjectSelectorOption[] {
  const query = normalizeSearchText(search);
  if (!query) return [...options];
  return options.filter((option) => option.searchText.includes(query));
}

export function resolveSelectedNewChatProjectSelectorOption(
  options: readonly NewChatProjectSelectorOption[],
  selectedProjectId: string | null,
): NewChatProjectSelectorOption | null {
  if (!selectedProjectId) return null;
  return options.find((option) => option.id === selectedProjectId) ?? null;
}
