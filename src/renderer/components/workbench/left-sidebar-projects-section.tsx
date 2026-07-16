import { useMemo } from "react";
import type { Project, ProjectCreateInput, ProjectUpdateInput } from "../../lib/types";
import type { ProjectRef } from "../../lib/use-workbench-state";
import {
  CodexProjectRow,
  CodexSidebarSection,
} from "./codex-sidebar";
import { SidebarProjectsSectionActions } from "./sidebar-projects-section-actions";

interface SidebarProjectsSectionProps {
  projects: Project[];
  projectRefs: ProjectRef[];
  activeProjectId: string;
  onSelectProject: (projectId: string) => void;
  onCreateProject: (input: ProjectCreateInput) => Promise<Project | null>;
  onUpdateProject: (projectId: string, updates: ProjectUpdateInput) => Promise<Project | null>;
  onDeleteProject: (projectId: string) => Promise<boolean>;
  expanded: boolean;
  onToggleExpanded: () => void;
  projectPickerOpenTick: number;
}

function resolveOrderedProjects(projects: Project[], projectRefs: ProjectRef[]) {
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const seen = new Set<string>();
  const orderedProjects: Array<{ project: Project; colorToken?: string }> = [];

  for (const projectRef of projectRefs) {
    const project = projectById.get(projectRef.projectId);
    if (!project || seen.has(project.id)) continue;
    seen.add(project.id);
    orderedProjects.push({ project, colorToken: projectRef.colorToken });
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
  projectRefs,
  activeProjectId,
  expanded,
  onToggleExpanded,
  onSelectProject,
  onCreateProject,
  onDeleteProject,
  onUpdateProject,
  projectPickerOpenTick,
}: SidebarProjectsSectionProps) {
  const orderedProjects = useMemo(
    () => resolveOrderedProjects(projects, projectRefs),
    [projects, projectRefs],
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
                onActivate={() => onSelectProject(project.id)}
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
