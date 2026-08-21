import { useMemo } from "react";
import type {
  Project,
  ProjectCreateInput,
  ProjectLifecycleMutationResult,
  ProjectUpdateInput,
} from "../../lib/types";
import { CodexProjectRow, CodexSidebarSection } from "./codex-sidebar";
import { SidebarProjectsSectionActions } from "./sidebar-projects-section-actions";

interface SidebarProjectsSectionProps {
  projects: Project[];
  projectOrder: string[];
  activeProjectId: string | null;
  onSelectProject: (projectId: string) => void;
  onCreateProject: (input: ProjectCreateInput) => Promise<Project | null>;
  onUpdateProject: (projectId: string, updates: ProjectUpdateInput) => Promise<Project | null>;
  onArchiveProject: (projectId: string) => Promise<ProjectLifecycleMutationResult>;
  expanded: boolean;
  onToggleExpanded: () => void;
  projectPickerOpenTick: number;
}

function resolveOrderedProjects(projects: Project[], projectOrder: string[]) {
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const seen = new Set<string>();
  const orderedProjects: Project[] = [];

  for (const projectId of projectOrder) {
    const project = projectById.get(projectId);
    if (!project || seen.has(project.id)) continue;
    seen.add(project.id);
    orderedProjects.push(project);
  }

  for (const project of projects) {
    if (seen.has(project.id)) continue;
    seen.add(project.id);
    orderedProjects.push(project);
  }

  return orderedProjects;
}

export function SidebarProjectsSection({
  projects,
  projectOrder,
  activeProjectId,
  expanded,
  onToggleExpanded,
  onSelectProject,
  onCreateProject,
  onArchiveProject,
  onUpdateProject,
  projectPickerOpenTick,
}: SidebarProjectsSectionProps) {
  const orderedProjects = useMemo(
    () => resolveOrderedProjects(projects, projectOrder),
    [projectOrder, projects],
  );

  return (
    <CodexSidebarSection
      heading="Projects"
      collapsed={!expanded}
      onToggle={onToggleExpanded}
      actions={
        <SidebarProjectsSectionActions
          onCreateProject={onCreateProject}
          openCreateDialogTick={projectPickerOpenTick}
        />
      }
    >
      <div className="isolate flex flex-col [contain:layout]">
        <div className="flex flex-col" role="list" aria-label="Projects">
          {orderedProjects.map((project) => {
            const isActive = project.id === activeProjectId;

            return (
              <CodexProjectRow
                key={project.id}
                project={project}
                active={isActive}
                expanded={isActive}
                onActivate={() => onSelectProject(project.id)}
                onUpdateProject={onUpdateProject}
                onArchiveProject={onArchiveProject}
              />
            );
          })}
        </div>
      </div>
    </CodexSidebarSection>
  );
}
