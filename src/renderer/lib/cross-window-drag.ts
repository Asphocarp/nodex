import { useSyncExternalStore } from "react";
import type {
  CrossWindowDragClaimInput,
  CrossWindowDragClaimResult,
  CrossWindowDragCompleteInput,
  CrossWindowDragPreview,
  CrossWindowDragSourceResult,
  CrossWindowDragStartInput,
} from "../../shared/cross-window-drag";
import {
  invoke,
  subscribeCrossWindowDragActiveChanges,
  subscribeCrossWindowDragSourceResults,
} from "./api";
import { resolveRendererTransport } from "./renderer-transport";

let activePreview: CrossWindowDragPreview | null = null;
let initialized = false;
const activeListeners = new Set<() => void>();
const sourceResultListeners = new Set<(result: CrossWindowDragSourceResult) => void>();

function emitActivePreview(preview: CrossWindowDragPreview | null): void {
  activePreview = preview;
  activeListeners.forEach((listener) => listener());
}

function ensureInitialized(): void {
  if (initialized || resolveRendererTransport().kind !== "electron") return;
  initialized = true;

  subscribeCrossWindowDragActiveChanges(emitActivePreview);
  subscribeCrossWindowDragSourceResults((result) => {
    sourceResultListeners.forEach((listener) => listener(result));
  });
  void invoke("cross-window-drag:active:get")
    .then(emitActivePreview)
    .catch(() => emitActivePreview(null));
}

export function isElectronCrossWindowDragAvailable(): boolean {
  return resolveRendererTransport().kind === "electron";
}

export function getCrossWindowDragPreview(): CrossWindowDragPreview | null {
  ensureInitialized();
  return activePreview;
}

export function subscribeCrossWindowDragPreview(listener: () => void): () => void {
  ensureInitialized();
  activeListeners.add(listener);
  return () => activeListeners.delete(listener);
}

export function useCrossWindowDragPreview(): CrossWindowDragPreview | null {
  return useSyncExternalStore(
    subscribeCrossWindowDragPreview,
    getCrossWindowDragPreview,
    () => null,
  );
}

export function subscribeCrossWindowDragResult(
  listener: (result: CrossWindowDragSourceResult) => void,
): () => void {
  ensureInitialized();
  sourceResultListeners.add(listener);
  return () => sourceResultListeners.delete(listener);
}

export async function startCrossWindowDrag(
  input: CrossWindowDragStartInput,
): Promise<boolean> {
  if (!isElectronCrossWindowDragAvailable()) return false;
  ensureInitialized();
  return invoke("cross-window-drag:start", input).catch(() => false);
}

export async function claimCrossWindowDrag(
  input: CrossWindowDragClaimInput,
): Promise<CrossWindowDragClaimResult | null> {
  if (!isElectronCrossWindowDragAvailable()) return null;
  return invoke("cross-window-drag:claim", input).catch(() => null);
}

export async function endCrossWindowDragSource(sessionId: string): Promise<boolean> {
  if (!isElectronCrossWindowDragAvailable()) return false;
  return invoke("cross-window-drag:source-ended", sessionId).catch(() => false);
}

export async function completeCrossWindowDrag(
  input: CrossWindowDragCompleteInput,
): Promise<boolean> {
  if (!isElectronCrossWindowDragAvailable()) return false;
  return invoke("cross-window-drag:complete", input).catch(() => false);
}

export async function discardCrossWindowDrag(sessionId: string): Promise<boolean> {
  if (!isElectronCrossWindowDragAvailable()) return false;
  return invoke("cross-window-drag:discard", sessionId).catch(() => false);
}
