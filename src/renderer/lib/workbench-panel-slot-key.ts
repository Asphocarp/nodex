import type { PanelId } from "@/lib/types";

export function makeWorkbenchPanelSlotKey(
  sessionId: string,
  panelId: PanelId,
  leafId?: string | null,
): string {
  return leafId
    ? `${sessionId}:${panelId}:${leafId}`
    : `${sessionId}:${panelId}`;
}

export function resolveWorkbenchPanelSlotLeafId(
  key: string,
  sessionId: string,
  panelId: PanelId,
): string | null {
  const leafPrefix = `${sessionId}:${panelId}:`;
  if (!key.startsWith(leafPrefix)) return null;
  return key.slice(leafPrefix.length) || null;
}

export function clearTransientPanelSelection(
  current: Record<string, string>,
  ...keys: string[]
): Record<string, string> {
  if (!keys.some((key) => key in current)) return current;
  const next = { ...current };
  for (const key of keys) delete next[key];
  return next;
}
