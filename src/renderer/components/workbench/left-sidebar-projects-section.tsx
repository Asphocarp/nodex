import { useEffect, useMemo, useRef, useState } from "react";
import type { Project } from "../../lib/types";
import type { SpaceRef } from "../../lib/use-workbench-state";
import { Plus } from "lucide-react";
import {
  ProjectManagerPopover,
  type SidebarProjectManagerDataProps,
} from "./left-sidebar-project-manager";
import { shouldOpenProjectManagerForRequest } from "./left-sidebar-project-manager-open-request";
import {
  CodexProjectRow,
  CodexSidebarActionButton,
  CodexSidebarSection,
} from "./codex-sidebar";

interface SidebarProjectsSectionProps extends SidebarProjectManagerDataProps {
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
  onRenameProject,
  projectPickerOpenTick,
}: SidebarProjectsSectionProps) {
  const [manageOpen, setManageOpen] = useState(false);
  const lastHandledProjectPickerOpenTickRef = useRef(projectPickerOpenTick);
  const orderedProjects = useMemo(
    () => resolveOrderedProjects(projects, spaces),
    [projects, spaces],
  );
  const visibleProjects = expanded
    ? orderedProjects
    : orderedProjects.filter(({ project }) => project.id === activeProjectId);

  useEffect(() => {
    if (!shouldOpenProjectManagerForRequest(projectPickerOpenTick, lastHandledProjectPickerOpenTickRef.current)) {
      return;
    }

    lastHandledProjectPickerOpenTickRef.current = projectPickerOpenTick;
    setManageOpen(true);
  }, [projectPickerOpenTick]);

  return (
    <CodexSidebarSection
      heading="Projects"
      collapsed={!expanded}
      onToggle={onToggleExpanded}
      actions={(
        <ProjectManagerPopover
          projects={projects}
          spaces={spaces}
          activeProjectId={activeProjectId}
          onSelectSpace={onSelectSpace}
          onCreateProject={onCreateProject}
          onDeleteProject={onDeleteProject}
          onRenameProject={onRenameProject}
          open={manageOpen}
          onOpenChange={setManageOpen}
          side="bottom"
          align="end"
          contentClassName="w-80"
          trigger={(
            <CodexSidebarActionButton label="Manage projects" title="Manage projects">
              <Plus className="size-3.5" />
            </CodexSidebarActionButton>
          )}
        />
      )}
    >
      <div className="pt-0.5">
        <div className="isolate flex flex-col [contain:layout]">
          <div className="flex flex-col" role="list" aria-label="Projects">
            {visibleProjects.map(({ project }) => {
              const isActive = project.id === activeProjectId;

              return (
                <CodexProjectRow
                  key={project.id}
                  project={project}
                  active={isActive}
                  expanded={isActive}
                  onActivate={() => onSelectSpace(project.id)}
                  onRenameProject={onRenameProject}
                  onManageProject={() => setManageOpen(true)}
                />
              );
            })}
          </div>
        </div>
      </div>
    </CodexSidebarSection>
  );
}
