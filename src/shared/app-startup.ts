export const APP_INITIALIZATION_STEP_CHANNEL = "app:init-step";
export const APP_RESTART_CHANNEL = "app:restart";

export type AppInitializationStep =
  | { phase: "opening" }
  | {
      completed?: number;
      fromVersion: number;
      phase: "migrating";
      toVersion: number;
      total?: number;
    }
  | { phase: "opening_workspace" }
  | { phase: "done" }
  | { phase: "failed" };
