export const REDUCED_MOTION_STORAGE_KEY = "nodex-reduced-motion-v1";

export type ReducedMotionPreference = "system" | "on" | "off";

export function normalizeReducedMotionPreference(value: unknown): ReducedMotionPreference {
  return value === "on" || value === "off" || value === "system" ? value : "system";
}

export function resolveReducedMotionPreference(
  preference: ReducedMotionPreference,
  systemReducedMotion: boolean,
): boolean {
  if (preference === "system") return systemReducedMotion;
  return preference === "on";
}

export function readReducedMotionPreference(): ReducedMotionPreference {
  if (typeof localStorage === "undefined") return "system";

  try {
    return normalizeReducedMotionPreference(
      localStorage.getItem(REDUCED_MOTION_STORAGE_KEY),
    );
  } catch {
    return "system";
  }
}

export function writeReducedMotionPreference(
  preference: ReducedMotionPreference,
): ReducedMotionPreference {
  const normalized = normalizeReducedMotionPreference(preference);
  if (typeof localStorage === "undefined") return normalized;

  try {
    localStorage.setItem(REDUCED_MOTION_STORAGE_KEY, normalized);
  } catch {
    // localStorage may be unavailable in isolated renderer contexts.
  }

  return normalized;
}
