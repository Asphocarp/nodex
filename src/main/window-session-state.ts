import { randomUUID } from "crypto";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import type {
  WindowRestorePolicy,
  WindowSessionBounds,
  WindowSessionCatalog,
  WindowSessionRecord,
  WindowSessionSeed,
} from "../shared/window-session";
import type {
  WorkbenchLayoutSnapshot,
  WorkspaceCatalog,
} from "../shared/workspace";
import { WindowSessionCatalogSchema } from "../shared/schemas/window-session";
import { WorkbenchLayoutSnapshotSchema } from "../shared/schemas/workspace";
import {
  createDefaultWorkbenchLayoutSnapshot,
} from "./workspace-state";

const WINDOW_SESSIONS_FILE_NAME = "window-sessions-v1.json";
const WINDOW_SESSION_VERSION = 1;
const MIN_WINDOW_WIDTH = 800;
const MIN_WINDOW_HEIGHT = 600;

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeLayout(value: unknown, fallback: WorkbenchLayoutSnapshot): WorkbenchLayoutSnapshot {
  const parsed = WorkbenchLayoutSnapshotSchema.safeParse(value);
  return parsed.success ? parsed.data : fallback;
}

function resolveFallbackWorkspaceId(workspaceCatalog: WorkspaceCatalog): string {
  return workspaceCatalog.workspaces.find((workspace) => workspace.id === workspaceCatalog.lastActiveWorkspaceId)?.id
    ?? workspaceCatalog.workspaces[0]?.id
    ?? "default";
}

function resolveWorkspaceLayout(
  workspaceCatalog: WorkspaceCatalog,
  workspaceId: string,
): WorkbenchLayoutSnapshot {
  return workspaceCatalog.workspaces.find((workspace) => workspace.id === workspaceId)?.layout
    ?? workspaceCatalog.workspaces[0]?.layout
    ?? createDefaultWorkbenchLayoutSnapshot();
}

function normalizeSessionBounds(value: WindowSessionBounds | undefined): WindowSessionBounds | undefined {
  if (!value) return undefined;
  if (value.width < MIN_WINDOW_WIDTH || value.height < MIN_WINDOW_HEIGHT) return undefined;
  return {
    x: Math.round(value.x),
    y: Math.round(value.y),
    width: Math.round(value.width),
    height: Math.round(value.height),
    mode: value.mode,
  };
}

export function isWindowSessionBoundsVisible(
  bounds: WindowSessionBounds | undefined,
  displays: Array<{ bounds: { x: number; y: number; width: number; height: number } }>,
): boolean {
  if (!bounds) return false;
  if (bounds.width < MIN_WINDOW_WIDTH || bounds.height < MIN_WINDOW_HEIGHT) return false;

  return displays.some((display) => {
    const displayBounds = display.bounds;
    const overlapX = Math.max(0, Math.min(bounds.x + bounds.width, displayBounds.x + displayBounds.width) - Math.max(bounds.x, displayBounds.x));
    const overlapY = Math.max(0, Math.min(bounds.y + bounds.height, displayBounds.y + displayBounds.height) - Math.max(bounds.y, displayBounds.y));
    return overlapX >= 120 && overlapY >= 120;
  });
}

export class WindowSessionState {
  private readonly statePath: string;
  private readonly webContentsToSessionId = new Map<number, string>();

  constructor(userDataPath: string) {
    this.statePath = join(userDataPath, WINDOW_SESSIONS_FILE_NAME);
  }

  createSession(workspaceCatalog: WorkspaceCatalog, seed: WindowSessionSeed = {}): WindowSessionRecord {
    const workspaceId = seed.workspaceId && workspaceCatalog.workspaces.some((workspace) => workspace.id === seed.workspaceId)
      ? seed.workspaceId
      : resolveFallbackWorkspaceId(workspaceCatalog);
    const fallbackLayout = resolveWorkspaceLayout(workspaceCatalog, workspaceId);
    const timestamp = nowIso();
    const session: WindowSessionRecord = {
      id: `window-${randomUUID()}`,
      workspaceId,
      layout: normalizeLayout(seed.layout, fallbackLayout),
      createdAt: timestamp,
      updatedAt: timestamp,
      focusedAt: timestamp,
    };
    const catalog = this.readCatalog() ?? {
      version: WINDOW_SESSION_VERSION,
      lastActiveSessionId: session.id,
      sessions: [],
    };
    const nextCatalog: WindowSessionCatalog = {
      version: WINDOW_SESSION_VERSION,
      lastActiveSessionId: session.id,
      sessions: [...catalog.sessions, session],
    };
    this.writeCatalog(nextCatalog);
    return session;
  }

  selectStartupSessions(
    policy: WindowRestorePolicy,
    workspaceCatalog: WorkspaceCatalog,
  ): WindowSessionRecord[] {
    const catalog = this.readOrCreateCatalog(workspaceCatalog);
    if (policy === "none" || catalog.sessions.length === 0) {
      const session = this.createSession(workspaceCatalog);
      this.writeCatalog({
        version: WINDOW_SESSION_VERSION,
        lastActiveSessionId: session.id,
        sessions: [session],
      });
      return [session];
    }

    if (policy === "last-window") {
      const lastActiveSession = catalog.sessions.find((session) => session.id === catalog.lastActiveSessionId)
        ?? catalog.sessions[0];
      return lastActiveSession ? [lastActiveSession] : [this.createSession(workspaceCatalog)];
    }

    return catalog.sessions;
  }

  assignWindow(webContentsId: number, sessionId: string): void {
    this.webContentsToSessionId.set(webContentsId, sessionId);
    this.markFocused(webContentsId);
  }

  clearWindow(webContentsId: number): void {
    this.webContentsToSessionId.delete(webContentsId);
  }

  bootstrap(webContentsId: number, workspaceCatalog: WorkspaceCatalog): WindowSessionRecord {
    const assignedSessionId = this.webContentsToSessionId.get(webContentsId);
    const catalog = this.readOrCreateCatalog(workspaceCatalog);
    const assignedSession = assignedSessionId
      ? catalog.sessions.find((session) => session.id === assignedSessionId)
      : undefined;

    if (assignedSession) {
      return assignedSession;
    }

    const session = this.createSession(workspaceCatalog);
    this.assignWindow(webContentsId, session.id);
    return session;
  }

  markFocused(webContentsId: number): void {
    const sessionId = this.webContentsToSessionId.get(webContentsId);
    if (!sessionId) return;
    const catalog = this.readCatalog();
    if (!catalog) return;
    const timestamp = nowIso();
    const nextCatalog: WindowSessionCatalog = {
      version: WINDOW_SESSION_VERSION,
      lastActiveSessionId: sessionId,
      sessions: catalog.sessions.map((session) =>
        session.id === sessionId ? { ...session, focusedAt: timestamp } : session
      ),
    };
    this.writeCatalog(nextCatalog);
  }

  saveLayout(
    webContentsId: number,
    workspaceId: string,
    layout: WorkbenchLayoutSnapshot,
    workspaceCatalog: WorkspaceCatalog,
    bounds?: WindowSessionBounds,
  ): WindowSessionRecord {
    const session = this.bootstrap(webContentsId, workspaceCatalog);
    const catalog = this.readOrCreateCatalog(workspaceCatalog);
    const timestamp = nowIso();
    const normalizedWorkspaceId = workspaceCatalog.workspaces.some((workspace) => workspace.id === workspaceId)
      ? workspaceId
      : resolveFallbackWorkspaceId(workspaceCatalog);
    const fallbackLayout = resolveWorkspaceLayout(workspaceCatalog, normalizedWorkspaceId);
    const normalizedBounds = normalizeSessionBounds(bounds);
    const nextSession: WindowSessionRecord = {
      ...session,
      workspaceId: normalizedWorkspaceId,
      layout: normalizeLayout(layout, fallbackLayout),
      updatedAt: timestamp,
      ...(normalizedBounds ? { bounds: normalizedBounds } : {}),
    };
    const sessions = catalog.sessions.some((entry) => entry.id === nextSession.id)
      ? catalog.sessions.map((entry) => entry.id === nextSession.id ? nextSession : entry)
      : [...catalog.sessions, nextSession];
    const nextCatalog: WindowSessionCatalog = {
      version: WINDOW_SESSION_VERSION,
      lastActiveSessionId: nextSession.id,
      sessions,
    };
    this.writeCatalog(nextCatalog);
    return nextSession;
  }

  updateBounds(webContentsId: number, bounds: WindowSessionBounds): void {
    const sessionId = this.webContentsToSessionId.get(webContentsId);
    if (!sessionId) return;
    const catalog = this.readCatalog();
    if (!catalog) return;
    const normalizedBounds = normalizeSessionBounds(bounds);
    if (!normalizedBounds) return;
    const timestamp = nowIso();
    const nextCatalog: WindowSessionCatalog = {
      version: WINDOW_SESSION_VERSION,
      lastActiveSessionId: sessionId,
      sessions: catalog.sessions.map((session) =>
        session.id === sessionId ? { ...session, bounds: normalizedBounds, updatedAt: timestamp } : session
      ),
    };
    this.writeCatalog(nextCatalog);
  }

  retainSessions(sessionIds: string[]): void {
    const catalog = this.readCatalog();
    if (!catalog) return;
    const sessions = sessionIds
      .map((sessionId) => catalog.sessions.find((session) => session.id === sessionId))
      .filter((session): session is WindowSessionRecord => Boolean(session))
      .filter((session, index, retained) =>
        retained.findIndex((entry) => entry.id === session.id) === index
      );
    if (sessions.length === 0 && sessionIds.length > 0) return;
    const lastActiveSessionId = sessions.some((session) => session.id === catalog.lastActiveSessionId)
      ? catalog.lastActiveSessionId
      : sessions[0]?.id ?? "";
    this.writeCatalog({
      version: WINDOW_SESSION_VERSION,
      lastActiveSessionId,
      sessions,
    });
  }

  getSessionIdForWindow(webContentsId: number): string | null {
    return this.webContentsToSessionId.get(webContentsId) ?? null;
  }

  getSessionForWindow(webContentsId: number): WindowSessionRecord | null {
    const sessionId = this.webContentsToSessionId.get(webContentsId);
    if (!sessionId) return null;
    const catalog = this.readCatalog();
    if (!catalog) return null;
    return catalog.sessions.find((session) => session.id === sessionId) ?? null;
  }

  readCatalog(): WindowSessionCatalog | null {
    try {
      const raw = readFileSync(this.statePath, "utf8");
      return this.normalizeCatalog(JSON.parse(raw), createDefaultWorkbenchLayoutSnapshot());
    } catch {
      return null;
    }
  }

  readOrCreateCatalog(workspaceCatalog: WorkspaceCatalog): WindowSessionCatalog {
    const existing = this.readCatalog();
    if (existing) {
      return this.normalizeCatalog(existing, resolveWorkspaceLayout(workspaceCatalog, resolveFallbackWorkspaceId(workspaceCatalog)))
        ?? existing;
    }

    const workspaceId = resolveFallbackWorkspaceId(workspaceCatalog);
    const timestamp = nowIso();
    const session: WindowSessionRecord = {
      id: `window-${randomUUID()}`,
      workspaceId,
      layout: resolveWorkspaceLayout(workspaceCatalog, workspaceId),
      createdAt: timestamp,
      updatedAt: timestamp,
      focusedAt: timestamp,
    };
    const catalog: WindowSessionCatalog = {
      version: WINDOW_SESSION_VERSION,
      lastActiveSessionId: session.id,
      sessions: [session],
    };
    this.writeCatalog(catalog);
    return catalog;
  }

  private normalizeCatalog(
    value: unknown,
    fallbackLayout: WorkbenchLayoutSnapshot,
  ): WindowSessionCatalog | null {
    const parsed = WindowSessionCatalogSchema.safeParse(value);
    if (!parsed.success) return null;
    const seen = new Set<string>();
    const sessions = parsed.data.sessions.filter((session) => {
      if (seen.has(session.id)) return false;
      seen.add(session.id);
      return true;
    }).map((session) => ({
      ...session,
      layout: normalizeLayout(session.layout, fallbackLayout),
      bounds: normalizeSessionBounds(session.bounds),
    }));
    const lastActiveSessionId = sessions.some((session) => session.id === parsed.data.lastActiveSessionId)
      ? parsed.data.lastActiveSessionId
      : sessions[0]?.id ?? "";
    return {
      version: WINDOW_SESSION_VERSION,
      lastActiveSessionId,
      sessions,
    };
  }

  private writeCatalog(catalog: WindowSessionCatalog): void {
    mkdirSync(dirname(this.statePath), { recursive: true });
    writeFileSync(this.statePath, JSON.stringify(catalog, null, 2), "utf8");
  }
}

export const windowSessionStateTestHelpers = {
  isWindowSessionBoundsVisible,
};
