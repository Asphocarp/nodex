import type {
  ComponentProps,
} from "react";
import { PendingWorktreeRoute } from "./pending-worktree-route";
import { WorkbenchAutomationsRouteShell } from "./workbench-automations-overlay";
import { SettingsRouteShell } from "./workbench-settings-route-shell";

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
  automations,
  pendingWorktree,
}: WorkbenchRouteSurfacesInput) {
  const settingsRouteShell = settings.path ? (
    <SettingsRouteShell path={settings.path} {...settings.props} />
  ) : null;

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
    pendingWorktreeRouteShell,
    settingsRouteShell,
  };
}
