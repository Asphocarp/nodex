import { useState } from "react";

import { SearchIcon } from "@/components/shared/icons";
import {
  NodexDialog,
  NodexDialogAction,
  NodexDialogBody,
  NodexDialogContent,
  NodexDialogDescription,
  NodexDialogFooter,
  NodexDialogFrame,
  NodexDialogHeader,
  NodexDialogTitle,
} from "@/components/ui/dialog";
import {
  NodexDropdownButtonTrigger,
  NodexDropdownChoiceMenu,
} from "@/components/ui/dropdown";
import { ProjectMarker } from "@/components/workbench/project-marker";
import type {
  LibraryAccess,
  LibraryProjectAccessRow,
  SetLibraryProjectAccessOperation,
} from "../../../shared/library-module";

export type LibraryProjectAccessDraft = Readonly<Record<string, LibraryAccess | null>>;

const ACCESS_LABELS: Record<LibraryAccess, string> = {
  read: "Read",
  read_write: "Read & write",
};

const accessStrength = (access: LibraryAccess | null): number => {
  if (access === "read_write") return 2;
  if (access === "read") return 1;
  return 0;
};

export const inheritedProjectAccess = (
  project: LibraryProjectAccessRow,
): LibraryAccess | null => project.inheritedSources.reduce<LibraryAccess | null>(
  (strongest, source) =>
    accessStrength(source.access) > accessStrength(strongest) ? source.access : strongest,
  null,
);

export const effectiveProjectAccess = (
  project: LibraryProjectAccessRow,
  directAccess: LibraryAccess | null,
): LibraryAccess | null => {
  const inherited = inheritedProjectAccess(project);
  const effective = accessStrength(directAccess) >= accessStrength(inherited)
    ? directAccess
    : inherited;
  if (project.lifecycle !== "active" && effective !== null) return "read";
  return effective;
};

const directAccessForProject = (
  project: LibraryProjectAccessRow,
  draft: LibraryProjectAccessDraft,
): LibraryAccess | null => Object.hasOwn(draft, project.projectId)
  ? draft[project.projectId] ?? null
  : project.directGrant?.access ?? null;

export const buildProjectAccessChanges = (
  projects: readonly LibraryProjectAccessRow[],
  draft: LibraryProjectAccessDraft,
): SetLibraryProjectAccessOperation["changes"] => projects.flatMap((project) => {
  const initialAccess = project.directGrant?.access ?? null;
  const draftAccess = directAccessForProject(project, draft);
  if (initialAccess === draftAccess) return [];
  return [{
    projectId: project.projectId,
    access: draftAccess,
    expectedRevision: project.directGrant?.revision ?? null,
  }];
});

const sourceDescription = (project: LibraryProjectAccessRow): string | null => {
  const source = project.inheritedSources[0];
  if (!source) return null;
  const access = ACCESS_LABELS[source.access];
  if (source.kind === "primary_database") {
    return `${access} through primary Database “${source.databaseName}”`;
  }
  if (source.kind === "database_grant") {
    return `${access} inherited from Database “${source.databaseName}”`;
  }
  return `${access} inherited from Page “${source.pageTitle || "Untitled"}”`;
};

const accessOptions = (
  project: LibraryProjectAccessRow,
): { value: string; label: string; disabled?: boolean }[] => {
  const inherited = inheritedProjectAccess(project);
  const inheritedLabel = inherited
    ? `Inherited — ${ACCESS_LABELS[inherited]}`
    : "No access";
  const primaryDatabaseAccess = project.inheritedSources.some(
    (source) => source.kind === "primary_database",
  );
  if (primaryDatabaseAccess) {
    const direct = project.directGrant?.access;
    return [
      { value: "none", label: inheritedLabel },
      ...(direct ? [{ value: direct, label: ACCESS_LABELS[direct] }] : []),
    ];
  }
  if (project.lifecycle !== "active") {
    const direct = project.directGrant?.access;
    return [
      { value: "none", label: inheritedLabel },
      ...(direct ? [{ value: direct, label: ACCESS_LABELS[direct] }] : []),
    ];
  }
  return [
    { value: "none", label: inheritedLabel },
    {
      value: "read",
      label: ACCESS_LABELS.read,
      disabled: inherited === "read_write",
    },
    { value: "read_write", label: ACCESS_LABELS.read_write },
  ];
};

const initialDraft = (
  projects: readonly LibraryProjectAccessRow[],
): LibraryProjectAccessDraft => Object.fromEntries(
  projects.map((project) => [project.projectId, project.directGrant?.access ?? null]),
);

export function LibraryResourceAccessDialog({
  open,
  title,
  projects,
  isLoading,
  error,
  isSaving,
  onOpenChange,
  onRetry,
  onSave,
}: {
  readonly open: boolean;
  readonly title: string;
  readonly projects: readonly LibraryProjectAccessRow[];
  readonly isLoading: boolean;
  readonly error: Error | null;
  readonly isSaving: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onRetry: () => void;
  readonly onSave: (
    changes: SetLibraryProjectAccessOperation["changes"],
  ) => void | Promise<void>;
}) {
  return (
    <NodexDialog open={open} onOpenChange={onOpenChange}>
      <NodexDialogContent size="default">
        <NodexDialogFrame>
          <NodexDialogHeader>
            <NodexDialogTitle>Manage access</NodexDialogTitle>
            <NodexDialogDescription>
              Choose which Projects can use {title}. Access inherited from a parent or primary
              Database is shown but cannot be reduced here.
            </NodexDialogDescription>
          </NodexDialogHeader>
          {!open ? null : isLoading || error ? (
            <>
              <NodexDialogBody>
                <div className="flex min-h-32 flex-col items-center justify-center gap-2 text-center text-sm text-token-description-foreground">
                  {error ? (
                    <>
                      <span>Couldn&apos;t load Project access.</span>
                      <button
                        type="button"
                        className="rounded-md px-2 py-1 text-token-foreground hover:bg-token-list-hover-background"
                        onClick={onRetry}
                      >
                        Try again
                      </button>
                    </>
                  ) : "Loading Project access…"}
                </div>
              </NodexDialogBody>
              <NodexDialogFooter>
                <NodexDialogAction onClick={() => onOpenChange(false)}>
                  Cancel
                </NodexDialogAction>
                <NodexDialogAction tone="primary" disabled>
                  Save changes
                </NodexDialogAction>
              </NodexDialogFooter>
            </>
          ) : (
            <LibraryResourceAccessEditor
              projects={projects}
              isSaving={isSaving}
              onCancel={() => onOpenChange(false)}
              onSave={onSave}
            />
          )}
        </NodexDialogFrame>
      </NodexDialogContent>
    </NodexDialog>
  );
}

function LibraryResourceAccessEditor({
  projects,
  isSaving,
  onCancel,
  onSave,
}: {
  readonly projects: readonly LibraryProjectAccessRow[];
  readonly isSaving: boolean;
  readonly onCancel: () => void;
  readonly onSave: (
    changes: SetLibraryProjectAccessOperation["changes"],
  ) => void | Promise<void>;
}) {
  const [draft, setDraft] = useState<LibraryProjectAccessDraft>(() => initialDraft(projects));
  const [query, setQuery] = useState("");
  const changes = buildProjectAccessChanges(projects, draft);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleProjects = normalizedQuery
    ? projects.filter((project) =>
        project.projectName.toLocaleLowerCase().includes(normalizedQuery)
      )
    : projects;

  return (
    <>
      <NodexDialogBody className="gap-2">
        {projects.length > 8 ? (
          <label className="flex h-8 items-center gap-2 rounded-lg bg-token-bg-secondary px-2.5 text-token-description-foreground focus-within:ring-1 focus-within:ring-token-focus-border">
            <SearchIcon className="icon-2xs" />
            <span className="sr-only">Search Projects</span>
            <input
              value={query}
              placeholder="Search Projects"
              className="min-w-0 flex-1 bg-transparent text-sm text-token-foreground outline-none placeholder:text-token-description-foreground"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
        ) : null}

        <div className="flex items-center px-2 text-xs text-token-description-foreground">
          <span className="min-w-0 flex-1">Project</span>
          <span className="w-[132px]">Access</span>
        </div>
        <div className="max-h-[360px] overflow-y-auto rounded-xl bg-token-foreground/[0.035] px-2">
          {projects.length === 0 ? (
            <div className="py-10 text-center text-sm text-token-description-foreground">
              No Projects in this Library
            </div>
          ) : visibleProjects.length === 0 ? (
            <div className="py-10 text-center text-sm text-token-description-foreground">
              No matching Projects
            </div>
          ) : visibleProjects.map((project) => {
            const directAccess = directAccessForProject(project, draft);
            const effectiveAccess = effectiveProjectAccess(project, directAccess);
            const inheritedDescription = sourceDescription(project);
            const lifecycleLabel = project.lifecycle === "active"
              ? null
              : project.lifecycle === "archived" ? "Archived" : "Inactive";
            const canChange = project.directGrant !== null || (
              project.lifecycle === "active"
              && inheritedProjectAccess(project) !== "read_write"
            );
            return (
              <div
                key={project.projectId}
                className="flex min-h-14 items-center gap-3 border-b border-token-border/50 py-2 last:border-b-0"
              >
                <ProjectMarker appearance={project.appearance} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-token-foreground">
                    {project.projectName}
                  </div>
                  {inheritedDescription || lifecycleLabel ? (
                    <div className="truncate text-xs text-token-description-foreground">
                      {[lifecycleLabel, inheritedDescription].filter(Boolean).join(" · ")}
                    </div>
                  ) : null}
                </div>
                <NodexDropdownChoiceMenu
                  value={directAccess ?? "none"}
                  onValueChange={(value) => setDraft((current) => ({
                    ...current,
                    [project.projectId]: value === "none"
                      ? null
                      : value as LibraryAccess,
                  }))}
                  options={accessOptions(project)}
                  disabled={!canChange || isSaving}
                  align="end"
                  contentWidth="sm"
                  triggerButton={(
                    <NodexDropdownButtonTrigger
                      size="sm"
                      className="w-[132px]"
                      aria-label={`Access for ${project.projectName}`}
                    >
                      {effectiveAccess ? ACCESS_LABELS[effectiveAccess] : "No access"}
                    </NodexDropdownButtonTrigger>
                  )}
                />
              </div>
            );
          })}
        </div>
      </NodexDialogBody>

      <NodexDialogFooter>
        <NodexDialogAction disabled={isSaving} onClick={onCancel}>
          Cancel
        </NodexDialogAction>
        <NodexDialogAction
          tone="primary"
          disabled={isSaving || changes.length === 0}
          onClick={() => void onSave(changes)}
        >
          {isSaving ? "Saving…" : "Save changes"}
        </NodexDialogAction>
      </NodexDialogFooter>
    </>
  );
}
