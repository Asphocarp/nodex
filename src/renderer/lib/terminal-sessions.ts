import { useSyncExternalStore } from "react";

/** Global store tracking active PTY-backed terminal session IDs. */

let sessions = new Set<string>();
const listeners = new Set<() => void>();

function notify(): void {
  for (const l of listeners) l();
}

export function addSession(id: string): void {
  if (sessions.has(id)) return;
  sessions = new Set(sessions);
  sessions.add(id);
  notify();
}

export function removeSession(id: string): void {
  if (!sessions.has(id)) return;
  sessions = new Set(sessions);
  sessions.delete(id);
  notify();
}

export function hasSession(id: string): boolean {
  return sessions.has(id);
}

/** React hook — returns the current set of active terminal session IDs. */
export function useActiveTerminals(): Set<string> {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    () => sessions,
  );
}

// ── Per-terminal UI state (panel open + height) ─────────────────────
// In-memory only — survives tab switching within a session.

const openPanels = new Set<string>();
const panelHeights = new Map<string, number>();

export function isPanelOpen(terminalId: string): boolean {
  return openPanels.has(terminalId);
}

export function setPanelOpen(terminalId: string, open: boolean): void {
  if (open) openPanels.add(terminalId);
  else openPanels.delete(terminalId);
}

const DEFAULT_PANEL_HEIGHT = 260;

export function getPanelHeight(terminalId: string): number {
  return panelHeights.get(terminalId) ?? DEFAULT_PANEL_HEIGHT;
}

export function setPanelHeight(terminalId: string, height: number): void {
  panelHeights.set(terminalId, height);
}

// Global listener: remove sessions when PTY exits (even if terminal panel is hidden).
if (typeof window !== "undefined" && window.api) {
  window.api.on("pty:exit", (...args: unknown[]) => {
    const payload = args[0] as { sessionId: string };
    removeSession(payload.sessionId);
  });
}
