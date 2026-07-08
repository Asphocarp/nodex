import type { Project } from "@/lib/types";

export interface WorkbenchAutomationProjectOption {
  value: string;
  label: string;
  description: string | null;
  isFallback: boolean;
}

function normalizeRoot(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}

function projectLabel(project: Project): string {
  return project.name.trim() || project.id;
}

function listProjectRoots(project: Project): string[] {
  const roots = new Set<string>();
  const primaryRoot = normalizeRoot(project.primaryWorkspaceRoot);
  if (primaryRoot) roots.add(primaryRoot);

  const orderedSources = [...project.sources].sort((left, right) => left.order - right.order);
  for (const source of orderedSources) {
    const root = normalizeRoot(source.root);
    if (root) roots.add(root);
  }

  return [...roots];
}

export function buildWorkbenchAutomationProjectOptions(input: {
  projects: readonly Project[];
  selectedRoots: readonly string[];
}): WorkbenchAutomationProjectOption[] {
  const options: WorkbenchAutomationProjectOption[] = [];
  const optionRoots = new Set<string>();

  for (const project of input.projects) {
    const label = projectLabel(project);
    for (const root of listProjectRoots(project)) {
      if (optionRoots.has(root)) continue;
      optionRoots.add(root);
      options.push({
        value: root,
        label,
        description: root,
        isFallback: false,
      });
    }
  }

  for (const selectedRoot of input.selectedRoots) {
    const root = normalizeRoot(selectedRoot);
    if (!root || optionRoots.has(root)) continue;
    optionRoots.add(root);
    options.push({
      value: root,
      label: root,
      description: null,
      isFallback: true,
    });
  }

  return options;
}

export function formatWorkbenchAutomationProjectTriggerLabel(input: {
  selectedRoots: readonly string[];
  options: readonly WorkbenchAutomationProjectOption[];
  placeholder?: string;
}): string {
  const placeholder = input.placeholder ?? "Select project";
  const selectedRoots = input.selectedRoots
    .map((root) => normalizeRoot(root))
    .filter((root): root is string => root !== null);
  if (selectedRoots.length === 0) return placeholder;
  if (selectedRoots.length > 1) return `${selectedRoots.length} projects`;

  const selectedRoot = selectedRoots[0];
  const option = input.options.find((item) => item.value === selectedRoot);
  return option?.label ?? selectedRoot ?? placeholder;
}

export function resolveWorkbenchAutomationProjectForRoot(input: {
  projects: readonly Project[];
  root: string | null | undefined;
}): Project | null {
  const root = normalizeRoot(input.root);
  if (!root) return null;

  return input.projects.find((project) => listProjectRoots(project).includes(root)) ?? null;
}

export function toggleWorkbenchAutomationProjectRoot(input: {
  selectedRoots: readonly string[];
  root: string;
}): string[] {
  const root = normalizeRoot(input.root);
  if (!root) return [...input.selectedRoots];

  const selectedRoots = input.selectedRoots
    .map((item) => normalizeRoot(item))
    .filter((item): item is string => item !== null);

  if (selectedRoots.includes(root)) {
    return selectedRoots.filter((item) => item !== root);
  }

  return [...selectedRoots, root];
}
