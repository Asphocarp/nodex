import type { CodexPersonality } from "../../shared/types";

export const parseCodexPersonality = (value: unknown): CodexPersonality | null =>
  value === "none" || value === "friendly" || value === "pragmatic" ? value : null;
