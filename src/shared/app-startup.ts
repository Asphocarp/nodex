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
