export type AppInitializationStep =
  | { phase: "opening" }
  | { fromVersion: number; phase: "migrating"; toVersion: number }
  | { phase: "done" }
  | { phase: "failed" };
