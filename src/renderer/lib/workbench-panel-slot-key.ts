import type { PanelId } from "@/lib/types";
import { makeWorkbenchSceneKey } from "../../shared/workbench-scene";

export function makeWorkbenchSessionPanelOwnerKey(sessionId: string): string {
  return makeWorkbenchSceneKey({ kind: "session", sessionId });
}

export function makeWorkbenchPanelSlotKey(
  panelOwnerKey: string,
  panelId: PanelId,
  leafId?: string | null,
): string {
  return leafId ? `${panelOwnerKey}:${panelId}:${leafId}` : `${panelOwnerKey}:${panelId}`;
}

export function makeWorkbenchSessionPanelSlotKey(
  sessionId: string,
  panelId: PanelId,
  leafId?: string | null,
): string {
  return makeWorkbenchPanelSlotKey(makeWorkbenchSessionPanelOwnerKey(sessionId), panelId, leafId);
}

export function resolveWorkbenchPanelSlotLeafId(
  key: string,
  sessionId: string,
  panelId: PanelId,
): string | null {
  const leafPrefix = `${makeWorkbenchSessionPanelOwnerKey(sessionId)}:${panelId}:`;
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
