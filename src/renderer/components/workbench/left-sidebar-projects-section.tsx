import { useMemo } from "react";
import type { Project, ProjectCreateInput, ProjectUpdateInput } from "../../lib/types";
import type { SpaceRef } from "../../lib/use-workbench-state";
import {
  CodexProjectRow,
  CodexSidebarSection,
} from "./codex-sidebar";
import { SidebarProjectsSectionActions } from "./sidebar-projects-section-actions";

interface SidebarProjectsSectionProps {
  projects: Project[];
  spaces: SpaceRef[];
  activeProjectId: string;
  onSelectSpace: (projectId: string) => void;
  onCreateProject: (input: ProjectCreateInput) => Promise<Project | null>;
  onUpdateProject: (projectId: string, updates: ProjectUpdateInput) => Promise<Project | null>;
  onDeleteProject: (projectId: string) => Promise<boolean>;
  expanded: boolean;
  onToggleExpanded: () => void;
  projectPickerOpenTick: number;
}

function resolveOrderedProjects(projects: Project[], spaces: SpaceRef[]) {
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const seen = new Set<string>();
  const orderedProjects: Array<{ project: Project; colorToken?: string }> = [];

  for (const space of spaces) {
    const project = projectById.get(space.projectId);
    if (!project || seen.has(project.id)) continue;
    seen.add(project.id);
    orderedProjects.push({ project, colorToken: space.colorToken });
  }

  for (const project of projects) {
    if (seen.has(project.id)) continue;
    seen.add(project.id);
    orderedProjects.push({ project });
  }

  return orderedProjects;
}

export function SidebarProjectsSection({
  projects,
  spaces,
  activeProjectId,
  expanded,
  onToggleExpanded,
  onSelectSpace,
  onCreateProject,
  onDeleteProject,
  onUpdateProject,
  projectPickerOpenTick,
}: SidebarProjectsSectionProps) {
  const orderedProjects = useMemo(
    () => resolveOrderedProjects(projects, spaces),
    [projects, spaces],
  );

  return (
    <CodexSidebarSection
      heading="Projects"
      collapsed={!expanded}
      onToggle={onToggleExpanded}
      actions={(
        <SidebarProjectsSectionActions
          onCreateProject={onCreateProject}
          openSetupTick={projectPickerOpenTick}
        />
      )}
    >
      <div className="isolate flex flex-col [contain:layout]">
        <div className="flex flex-col" role="list" aria-label="Projects">
          {orderedProjects.map(({ project }) => {
            const isActive = project.id === activeProjectId;

            return (
              <CodexProjectRow
                key={project.id}
                project={project}
                active={isActive}
                expanded={isActive}
                onActivate={() => onSelectSpace(project.id)}
                onUpdateProject={onUpdateProject}
                onDeleteProject={onDeleteProject}
              />
            );
          })}
        </div>
      </div>
    </CodexSidebarSection>
  );
}
