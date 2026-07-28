import type {
  ComponentProps,
} from "react";
import type {
  WorkbenchLibraryLocationTarget,
} from "../../../shared/workbench-layout";
import type {
  LibraryResourceTarget,
} from "../library/library-resource-actions";
import type {
  LibraryRouteTarget,
} from "../../../shared/library-module";
import { LibraryDatabaseRoute } from "../library/library-database-route";
import { LibraryHome } from "../library/library-home";
import { LibraryPageRoute } from "../library/library-page-route";
import { PendingWorktreeRoute } from "./pending-worktree-route";
import { WorkbenchAutomationsRouteShell } from "./workbench-automations-overlay";
import { SettingsRouteShell } from "./workbench-settings-overlay";

type SettingsProps = Omit<
  ComponentProps<typeof SettingsRouteShell>,
  "path"
>;
type AutomationsProps = Omit<
  ComponentProps<typeof WorkbenchAutomationsRouteShell>,
  "path"
>;
type PendingWorktreeProps = Omit<
  ComponentProps<typeof PendingWorktreeRoute>,
  "clientThreadId"
>;

interface WorkbenchRouteSurfacesInput {
  readonly settings: {
    readonly path: string | null;
    readonly props: SettingsProps;
  };
  readonly library: {
    readonly enabled: boolean;
    readonly route: WorkbenchLibraryLocationTarget | null;
    readonly projects: readonly {
      readonly id: string;
      readonly name: string;
    }[];
    readonly onOpenHome: () => void;
    readonly onOpenTarget: (
      target: LibraryRouteTarget,
    ) => void;
    readonly onOpenTargetInProject: (
      projectId: string,
      target: LibraryResourceTarget,
      title: string,
    ) => Promise<void>;
  };
  readonly automations: {
    readonly path: string | null;
    readonly props: AutomationsProps;
  };
  readonly pendingWorktree: {
    readonly clientThreadId: string | null;
    readonly props: PendingWorktreeProps;
  };
}

/**
 * Owns auxiliary route surface selection. The Shell supplies route state and
 * route-specific ports, then consumes the resulting mutually-exclusive views.
 */
export function useWorkbenchRouteSurfaces({
  settings,
  library,
  automations,
  pendingWorktree,
}: WorkbenchRouteSurfacesInput) {
  const settingsRouteShell = settings.path ? (
    <SettingsRouteShell path={settings.path} {...settings.props} />
  ) : null;

  const libraryRoute = library.enabled ? library.route : null;
  const libraryRouteShell = libraryRoute
    ? libraryRoute.kind === "page"
      ? (
          <LibraryPageRoute
            pageId={libraryRoute.pageId}
            onBack={library.onOpenHome}
            onOpenDatabase={(databaseId) =>
              library.onOpenTarget({
                kind: "database",
                databaseId,
              })}
          />
        )
      : libraryRoute.kind === "database"
          || libraryRoute.kind === "view"
        ? (
            <LibraryDatabaseRoute
              target={libraryRoute}
              accessProjectId={libraryRoute.accessProjectId}
              onBack={library.onOpenHome}
              onOpenPage={(pageId, title) => {
                if (libraryRoute.accessProjectId) {
                  void library.onOpenTargetInProject(
                    libraryRoute.accessProjectId,
                    { kind: "page", pageId },
                    title,
                  );
                  return;
                }
                library.onOpenTarget({ kind: "page", pageId });
              }}
            />
          )
        : (
            <LibraryHome
              onOpen={library.onOpenTarget}
              projects={library.projects}
              onOpenInProject={library.onOpenTargetInProject}
            />
          )
    : null;

  const automationsRouteShell = automations.path ? (
    <WorkbenchAutomationsRouteShell
      path={automations.path}
      {...automations.props}
    />
  ) : null;

  const pendingWorktreeRouteShell =
    pendingWorktree.clientThreadId ? (
      <PendingWorktreeRoute
        clientThreadId={pendingWorktree.clientThreadId}
        {...pendingWorktree.props}
      />
    ) : null;

  return {
    automationsRouteShell,
    libraryRouteShell,
    pendingWorktreeRouteShell,
    settingsRouteShell,
  };
}
