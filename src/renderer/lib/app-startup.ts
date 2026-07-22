import type { AppInitializationStep } from "../../shared/app-startup";

export function getStartupStatus(step: AppInitializationStep): string {
  if (step.phase === "migrating") return "Updating local data…";
  if (step.phase === "failed") return "Nodex could not finish opening.";
  return "Opening Nodex…";
}
