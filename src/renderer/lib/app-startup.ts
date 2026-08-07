import type { AppInitializationStep } from "../../shared/app-startup";

export function getStartupStatus(step: AppInitializationStep): string {
  if (step.phase === "migrating") {
    if (step.completed === undefined || step.total === undefined) {
      return "Updating local data…";
    }
    const percentage = Math.floor((step.completed / step.total) * 100);
    return `Updating local data… ${percentage}%`;
  }
  if (step.phase === "opening_workspace") return "Opening workspace…";
  if (step.phase === "failed") return "Nodex could not finish opening.";
  return "Opening Nodex…";
}
