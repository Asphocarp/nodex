import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as pty from "node-pty";
import { getLogger } from "./logging/logger";
import type {
  TerminalAttachRequest,
  TerminalBackendKind,
  TerminalCreateRequest,
  TerminalRunActionRequest,
  TerminalSessionSnapshot,
  TerminalSize,
  TerminalTakeOverViewRequest,
  TerminalViewLeaseResult,
} from "../shared/types";
import { readTerminalProcessMetricsByRootPid } from "./terminal-process-metrics";
import { appendTextTail } from "../shared/bounded-text";

export const TERMINAL_BUFFER_LIMIT = 16_000;

type TerminalEventName =
  | "terminal-data"
  | "terminal-init-log"
  | "terminal-attached"
  | "terminal-view-lease-revoked"
  | "terminal-error"
  | "terminal-exit";

type TerminalEventPayload =
  | { sessionId: string; data: string }
  | { sessionId: string; data: string; snapshot: TerminalSessionSnapshot }
  | { sessionId: string; snapshot: TerminalSessionSnapshot }
  | { sessionId: string; message: string }
  | { sessionId: string; exitCode: number | null; reason: "exited" | "killed" }
  | { sessionId: string; generation: number; ownerWindowSessionId: string };

type EmitTerminalEvent = (
  channel: TerminalEventName,
  payload: TerminalEventPayload,
) => void;

interface TerminalBackendHandle {
  process: pty.IPty;
  onDataDisposable: pty.IDisposable;
  onExitDisposable: pty.IDisposable;
}

interface TerminalManagerSession {
  sessionId: string;
  conversationId: string | null;
  projectSessionId: string | null;
  cwd: string | null;
  shell: string | null;
  title: string | null;
  backendKind: TerminalBackendKind;
  backend: TerminalBackendHandle | null;
  osPid: number | null;
  cpuPercent: number | null;
  rssKb: bigint | null;
  childProcessCount: number | null;
  processMetricsSampledAtMs: number | null;
  buffer: string;
  truncated: boolean;
  exited: boolean;
  exitCode: number | null;
  lease: TerminalViewLease | null;
  leaseGeneration: number;
  pendingAction: Promise<void> | null;
}

interface TerminalViewLease {
  windowSessionId: string;
  webContentsId: number;
  size: TerminalSize;
  generation: number;
}

interface TerminalEventPublisher {
  broadcast(channel: TerminalEventName, payload: TerminalEventPayload): void;
  sendToWebContentsId(
    webContentsId: number,
    channel: TerminalEventName,
    payload: TerminalEventPayload,
  ): void;
}

const logger = getLogger({ subsystem: "terminal" });

function normalizeSize(size: TerminalSize | null | undefined): TerminalSize {
  const cols = Math.max(2, Math.floor(size?.cols ?? 80));
  const rows = Math.max(1, Math.floor(size?.rows ?? 24));
  return { cols, rows };
}

function getDefaultShell(): string {
  if (process.platform === "win32") return "powershell.exe";
  return process.env.SHELL || "/bin/zsh";
}

export function resolveDefaultTerminalCommand(
  shell = getDefaultShell(),
  platform: NodeJS.Platform = process.platform,
): string[] {
  if (platform === "win32") return [shell];

  const basename = path.basename(shell).toLowerCase();
  if (basename === "bash") return [shell, "--login", "-i"];
  if (basename === "zsh" || basename === "fish") return [shell, "-l", "-i"];
  return [shell, "-i"];
}

function directoryExists(pathname: string): boolean {
  try {
    return fs.statSync(pathname).isDirectory();
  } catch {
    return false;
  }
}

function resolveTerminalCwd(requestedCwd: string | null | undefined): string {
  const trimmed = requestedCwd?.trim();
  if (trimmed && directoryExists(trimmed)) return trimmed;

  const home = os.homedir();
  if (home && directoryExists(home)) return home;

  return process.cwd();
}

function buildTerminalEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") env[key] = value;
  }

  env.TERM = "xterm-256color";

  if (process.platform !== "win32") {
    delete env.TERMINFO;
    delete env.TERMINFO_DIRS;
  }

  return env;
}

function normalizeOsPid(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value)) return null;
  const normalized = Math.trunc(value);
  return normalized > 0 ? normalized : null;
}

function appendBoundedBuffer(
  current: string,
  incoming: string,
): { buffer: string; truncated: boolean } {
  const next = appendTextTail({
    current,
    delta: incoming,
    maxChars: TERMINAL_BUFFER_LIMIT,
  });
  return {
    buffer: next.text,
    truncated: next.didTruncate,
  };
}

function commandWithNewline(command: string): string {
  if (command.endsWith("\n") || command.endsWith("\r")) return command;
  return `${command}\r`;
}

function observeBrowserSidebarPtyData(sessionId: string, data: string): void {
  void import("./browser-sidebar-service")
    .then(({ browserSidebarService }) => {
      browserSidebarService.observePtyData(sessionId, data);
    })
    .catch((error: unknown) => {
      logger.warn("Failed to observe terminal output for local server discovery", {
        sessionId,
        error,
      });
    });
}

export class TerminalManager {
  private readonly sessionsById = new Map<string, TerminalManagerSession>();
  private readonly sessionByConversationId = new Map<string, string>();
  private readonly sessionByProjectSessionId = new Map<string, string>();
  private readonly fallbackEmittersByWebContentsId = new Map<number, EmitTerminalEvent>();
  private eventPublisher: TerminalEventPublisher | null = null;

  configureEventPublisher(publisher: TerminalEventPublisher): void {
    this.eventPublisher = publisher;
  }

  create(
    owner: Electron.WebContents,
    windowSessionId: string,
    request: TerminalCreateRequest,
    emit: EmitTerminalEvent,
  ): TerminalViewLeaseResult {
    this.rememberEmitter(owner.id, emit);
    const existing = this.sessionsById.get(request.sessionId);
    if (existing) {
      return this.acquireViewLease(owner, windowSessionId, request, emit);
    }

    if (request.backendKind === "remote") {
      this.emitError(
        emit,
        request.sessionId,
        "Remote terminal backend is not available in this Nodex build.",
      );
      return { status: "not_found" };
    }

    const size = normalizeSize(request.size);
    const cwd = resolveTerminalCwd(request.cwd);
    const shell = getDefaultShell();
    const session: TerminalManagerSession = {
      sessionId: request.sessionId,
      conversationId: request.conversationId ?? null,
      projectSessionId: request.projectSessionId ?? null,
      cwd,
      shell,
      title: request.title ?? null,
      backendKind: request.backendKind ?? "local",
      backend: null,
      osPid: null,
      cpuPercent: null,
      rssKb: null,
      childProcessCount: null,
      processMetricsSampledAtMs: null,
      buffer: "",
      truncated: false,
      exited: false,
      exitCode: null,
      lease: {
        windowSessionId,
        webContentsId: owner.id,
        size,
        generation: 1,
      },
      leaseGeneration: 1,
      pendingAction: null,
    };

    this.sessionsById.set(session.sessionId, session);
    this.linkSession(session);

    const spawned = this.spawnLocalBackend(session, size, emit);
    if (!spawned) {
      this.unlinkSession(session);
      this.sessionsById.delete(session.sessionId);
      return { status: "not_found" };
    }

    this.flushInit(session, true);
    this.sendAttached(session);
    return {
      status: "acquired",
      generation: session.leaseGeneration,
      snapshot: this.snapshotSession(session),
    };
  }

  acquireViewLease(
    owner: Electron.WebContents,
    windowSessionId: string,
    request: TerminalAttachRequest,
    emit: EmitTerminalEvent,
  ): TerminalViewLeaseResult {
    this.rememberEmitter(owner.id, emit);
    const session = this.sessionsById.get(request.sessionId);
    if (!session) {
      return this.create(
        owner,
        windowSessionId,
        {
          sessionId: request.sessionId,
          conversationId: request.conversationId,
          projectSessionId: request.projectSessionId,
          cwd: request.cwd,
          size: request.size,
        },
        emit,
      );
    }

    session.conversationId = request.conversationId ?? session.conversationId;
    session.projectSessionId = request.projectSessionId ?? session.projectSessionId;
    this.linkSession(session);
    const existingLease = session.lease;
    if (
      existingLease
      && (
        existingLease.webContentsId !== owner.id
        || existingLease.windowSessionId !== windowSessionId
      )
    ) {
      return {
        status: "conflict",
        generation: existingLease.generation,
        ownerWindowSessionId: existingLease.windowSessionId,
        snapshot: this.snapshotSession(session),
      };
    }

    const status = existingLease ? "already_owned" : "acquired";
    const size = normalizeSize(request.size);
    if (existingLease) {
      existingLease.size = size;
    } else {
      session.leaseGeneration += 1;
      session.lease = {
        windowSessionId,
        webContentsId: owner.id,
        size,
        generation: session.leaseGeneration,
      };
    }
    this.resizeBackend(session, size, emit);
    this.flushInit(session);
    this.sendAttached(session);
    return {
      status,
      generation: session.lease?.generation ?? session.leaseGeneration,
      snapshot: this.snapshotSession(session),
    };
  }

  write(
    owner: Electron.WebContents,
    windowSessionId: string,
    sessionId: string,
    data: string,
    emit: EmitTerminalEvent,
  ): void {
    const session = this.sessionsById.get(sessionId);
    if (!session) {
      this.emitError(emit, sessionId, "Terminal session does not exist.");
      return;
    }

    if (!this.ensureLeaseOwner(owner, windowSessionId, session, emit)) return;
    if (!session.backend || session.exited) {
      this.emitError(emit, sessionId, "Terminal session is not running.");
      return;
    }

    session.backend.process.write(data);
  }

  resize(
    owner: Electron.WebContents,
    windowSessionId: string,
    sessionId: string,
    size: TerminalSize,
    emit: EmitTerminalEvent,
  ): void {
    const session = this.sessionsById.get(sessionId);
    if (!session) return;
    if (!this.ensureLeaseOwner(owner, windowSessionId, session, emit)) return;

    const normalizedSize = normalizeSize(size);
    const lease = session.lease;
    if (!lease) return;
    if (
      normalizedSize.cols === lease.size.cols &&
      normalizedSize.rows === lease.size.rows
    ) {
      return;
    }

    lease.size = normalizedSize;
    this.resizeBackend(session, normalizedSize, emit);
  }

  releaseViewLease(
    owner: Electron.WebContents,
    windowSessionId: string,
    sessionId: string,
  ): void {
    const session = this.sessionsById.get(sessionId);
    if (!session) return;
    const lease = session.lease;
    if (
      !lease
      || lease.webContentsId !== owner.id
      || lease.windowSessionId !== windowSessionId
    ) {
      return;
    }
    session.lease = null;
  }

  killSession(sessionId: string): void {
    const session = this.sessionsById.get(sessionId);
    if (!session) return;
    this.disposeBackend(session, true);
    this.unlinkSession(session);
    this.sessionsById.delete(sessionId);
    this.broadcast("terminal-exit", {
      sessionId,
      exitCode: null,
      reason: "killed",
    });
  }

  takeOverViewLease(
    owner: Electron.WebContents,
    windowSessionId: string,
    request: TerminalTakeOverViewRequest,
    emit: EmitTerminalEvent,
  ): TerminalViewLeaseResult {
    this.rememberEmitter(owner.id, emit);
    const session = this.sessionsById.get(request.sessionId);
    if (!session) return { status: "not_found" };
    const previousLease = session.lease;
    if (!previousLease) {
      return this.acquireViewLease(owner, windowSessionId, {
        sessionId: request.sessionId,
        size: request.size,
      }, emit);
    }
    if (
      previousLease.webContentsId === owner.id
      && previousLease.windowSessionId === windowSessionId
    ) {
      return this.acquireViewLease(owner, windowSessionId, {
        sessionId: request.sessionId,
        size: request.size,
      }, emit);
    }
    if (previousLease.generation !== request.expectedGeneration) {
      return {
        status: "stale",
        generation: previousLease.generation,
        ownerWindowSessionId: previousLease.windowSessionId,
        snapshot: this.snapshotSession(session),
      };
    }

    session.leaseGeneration += 1;
    const nextGeneration = session.leaseGeneration;
    this.sendToWebContentsId(
      previousLease.webContentsId,
      "terminal-view-lease-revoked",
      {
        sessionId: session.sessionId,
        generation: nextGeneration,
        ownerWindowSessionId: windowSessionId,
      },
    );
    session.lease = {
      windowSessionId,
      webContentsId: owner.id,
      size: normalizeSize(request.size),
      generation: nextGeneration,
    };
    this.resizeBackend(session, session.lease.size, emit);
    this.flushInit(session);
    this.sendAttached(session);
    return {
      status: "acquired",
      generation: session.lease.generation,
      snapshot: this.snapshotSession(session),
    };
  }

  releaseLeasesForWebContents(webContentsId: number): void {
    for (const session of this.sessionsById.values()) {
      if (session.lease?.webContentsId === webContentsId) {
        session.lease = null;
      }
    }
    this.fallbackEmittersByWebContentsId.delete(webContentsId);
  }

  async runAction(
    owner: Electron.WebContents,
    windowSessionId: string,
    request: TerminalRunActionRequest,
    emit: EmitTerminalEvent,
  ): Promise<void> {
    const session = this.sessionsById.get(request.sessionId);
    if (!session) {
      this.create(
        owner,
        windowSessionId,
        {
          sessionId: request.sessionId,
          conversationId: request.conversationId,
          projectSessionId: request.projectSessionId,
          cwd: request.cwd,
          size: request.size ?? { cols: 80, rows: 24 },
          title: request.title,
        },
        emit,
      );
      this.write(
        owner,
        windowSessionId,
        request.sessionId,
        commandWithNewline(request.command),
        emit,
      );
      return;
    }

    if (!this.ensureLeaseOwner(owner, windowSessionId, session, emit)) return;

    const previousAction = session.pendingAction ?? Promise.resolve();
    const nextAction = previousAction
      .catch(() => undefined)
      .then(() => this.restartForAction(
        owner,
        windowSessionId,
        session,
        request,
        emit,
      ));
    const trackedAction = nextAction.finally(() => {
      if (session.pendingAction === trackedAction) session.pendingAction = null;
    });
    session.pendingAction = trackedAction;
    await trackedAction;
  }

  getThreadSnapshot(threadId: string): TerminalSessionSnapshot | null {
    const directSessionId = this.sessionByConversationId.get(threadId);
    const sessionId = directSessionId ?? this.sessionByProjectSessionId.get(threadId);
    if (!sessionId) return null;

    const session = this.sessionsById.get(sessionId);
    return session ? this.snapshotSession(session) : null;
  }

  getSessionSnapshot(sessionId: string): TerminalSessionSnapshot | null {
    const session = this.sessionsById.get(sessionId);
    return session ? this.snapshotSession(session) : null;
  }

  listLiveSessionsForOwners(input: {
    conversationIds: ReadonlySet<string>;
    projectSessionIds: ReadonlySet<string>;
  }): TerminalSessionSnapshot[] {
    return [...this.sessionsById.values()]
      .filter((session) => {
        if (!session.backend || session.exited) return false;
        return (session.conversationId !== null && input.conversationIds.has(session.conversationId))
          || (session.projectSessionId !== null && input.projectSessionIds.has(session.projectSessionId));
      })
      .map((session) => this.snapshotSession(session));
  }

  discardExitedSessionsForOwners(input: {
    conversationIds: ReadonlySet<string>;
    projectSessionIds: ReadonlySet<string>;
  }): string[] {
    const discardedSessionIds: string[] = [];
    for (const session of this.sessionsById.values()) {
      if (!session.exited) continue;
      const owned = (session.conversationId !== null && input.conversationIds.has(session.conversationId))
        || (session.projectSessionId !== null && input.projectSessionIds.has(session.projectSessionId));
      if (!owned) continue;

      this.disposeBackend(session, false);
      this.unlinkSession(session);
      this.sessionsById.delete(session.sessionId);
      discardedSessionIds.push(session.sessionId);
    }
    return discardedSessionIds;
  }

  async refreshSessionProcessMetrics(sessionIds: readonly string[]): Promise<void> {
    const uniqueSessionIds = [...new Set(sessionIds.map((sessionId) => sessionId.trim()).filter(Boolean))];
    const sessions = uniqueSessionIds.flatMap((sessionId) => {
      const session = this.sessionsById.get(sessionId);
      if (!session) return [];

      if (!session.backend || session.exited || session.osPid === null) {
        this.clearSessionProcessMetrics(session);
        return [];
      }

      return [session];
    });
    if (sessions.length === 0) return;

    try {
      const metricsByRootPid = await readTerminalProcessMetricsByRootPid(
        sessions.map((session) => session.osPid!),
      );
      for (const session of sessions) {
        if (this.sessionsById.get(session.sessionId) !== session || session.exited || !session.backend) {
          continue;
        }

        const metrics = metricsByRootPid.get(session.osPid!);
        if (!metrics) {
          this.clearSessionProcessMetrics(session);
          continue;
        }

        session.cpuPercent = metrics.cpuPercent;
        session.rssKb = metrics.rssKb;
        session.childProcessCount = metrics.childProcessCount;
        session.processMetricsSampledAtMs = metrics.sampledAtMs;
      }
    } catch (error) {
      for (const session of sessions) this.clearSessionProcessMetrics(session);
      logger.debug("Failed to refresh terminal process metrics", {
        sessionIds: sessions.map((session) => session.sessionId),
        error,
      });
    }
  }

  killAll(): void {
    for (const session of this.sessionsById.values()) {
      this.disposeBackend(session, true);
    }
    this.sessionsById.clear();
    this.sessionByConversationId.clear();
    this.sessionByProjectSessionId.clear();
  }

  private async restartForAction(
    owner: Electron.WebContents,
    windowSessionId: string,
    session: TerminalManagerSession,
    request: TerminalRunActionRequest,
    emit: EmitTerminalEvent,
  ): Promise<void> {
    if (!this.ensureLeaseOwner(owner, windowSessionId, session, emit)) return;

    this.disposeBackend(session, true);

    session.conversationId = request.conversationId ?? session.conversationId;
    session.projectSessionId = request.projectSessionId ?? session.projectSessionId;
    session.cwd = resolveTerminalCwd(request.cwd ?? session.cwd);
    session.shell = getDefaultShell();
    session.title = request.title ?? session.title;
    session.buffer = "";
    session.truncated = false;
    session.exited = false;
    session.exitCode = null;
    session.osPid = null;
    this.clearSessionProcessMetrics(session);
    const size = normalizeSize(request.size ?? session.lease?.size);
    if (session.lease) session.lease.size = size;
    this.linkSession(session);

    if (!this.spawnLocalBackend(session, size, emit)) return;

    this.flushInit(session, true);
    this.sendAttached(session);
    session.backend?.process.write(commandWithNewline(request.command));
  }

  private spawnLocalBackend(
    session: TerminalManagerSession,
    size: TerminalSize,
    emit: EmitTerminalEvent,
  ): boolean {
    if (session.backendKind !== "local") {
      this.emitError(
        emit,
        session.sessionId,
        "Remote terminal backend is not available in this Nodex build.",
      );
      return false;
    }

    const shell = session.shell ?? getDefaultShell();
    const cwd = session.cwd ?? resolveTerminalCwd(null);
    const [command, ...args] = resolveDefaultTerminalCommand(shell);

    try {
      const proc = pty.spawn(command, args, {
        name: "xterm-256color",
        cols: size.cols,
        rows: size.rows,
        cwd,
        env: buildTerminalEnv(),
      });

      const onDataDisposable = proc.onData((data) => {
        const nextBuffer = appendBoundedBuffer(session.buffer, data);
        session.buffer = nextBuffer.buffer;
        session.truncated = session.truncated || nextBuffer.truncated;
        observeBrowserSidebarPtyData(session.sessionId, data);
        this.sendToLease(session, "terminal-data", {
          sessionId: session.sessionId,
          data,
        });
      });

      const onExitDisposable = proc.onExit(({ exitCode }) => {
        session.exited = true;
        session.exitCode = typeof exitCode === "number" ? exitCode : null;
        this.clearSessionProcessMetrics(session);
        this.disposeBackend(session, false);
        session.lease = null;
        this.broadcast("terminal-exit", {
          sessionId: session.sessionId,
          exitCode: session.exitCode,
          reason: "exited",
        });
      });

      session.backend = { process: proc, onDataDisposable, onExitDisposable };
      session.osPid = normalizeOsPid(proc.pid);
      this.clearSessionProcessMetrics(session);
      session.exited = false;
      session.exitCode = null;
      session.cwd = cwd;
      session.shell = shell;

      logger.info("Terminal session spawned", {
        sessionId: session.sessionId,
        leaseWindowSessionId: session.lease?.windowSessionId ?? null,
        cwd,
        shell,
        osPid: session.osPid,
        cols: size.cols,
        rows: size.rows,
      });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to spawn terminal.";
      logger.error("Failed to spawn terminal session", {
        sessionId: session.sessionId,
        error,
        message,
      });
      this.emitError(emit, session.sessionId, message);
      return false;
    }
  }

  private disposeBackend(session: TerminalManagerSession, kill: boolean): void {
    const backend = session.backend;
    if (!backend) return;

    backend.onDataDisposable.dispose();
    backend.onExitDisposable.dispose();
    if (kill) {
      try {
        backend.process.kill();
      } catch (error) {
        logger.warn("Failed to kill terminal backend", {
          sessionId: session.sessionId,
          error,
        });
      }
    }
    session.backend = null;
  }

  private clearSessionProcessMetrics(session: TerminalManagerSession): void {
    session.cpuPercent = null;
    session.rssKb = null;
    session.childProcessCount = null;
    session.processMetricsSampledAtMs = null;
  }

  private ensureLeaseOwner(
    owner: Electron.WebContents,
    windowSessionId: string,
    session: TerminalManagerSession,
    emit: EmitTerminalEvent,
  ): boolean {
    if (
      session.lease?.webContentsId === owner.id
      && session.lease.windowSessionId === windowSessionId
    ) {
      return true;
    }

    this.emitError(
      emit,
      session.sessionId,
      "Terminal is active in another window.",
    );
    return false;
  }

  private emitError(
    emit: EmitTerminalEvent,
    sessionId: string,
    message: string,
  ): void {
    emit("terminal-error", { sessionId, message });
  }

  private flushInit(
    session: TerminalManagerSession,
    force = false,
  ): void {
    if (force || session.buffer.length > 0) {
      this.sendToLease(session, "terminal-init-log", {
        sessionId: session.sessionId,
        data: session.buffer,
        snapshot: this.snapshotSession(session),
      });
    }
  }

  private sendAttached(
    session: TerminalManagerSession,
  ): void {
    this.sendToLease(session, "terminal-attached", {
      sessionId: session.sessionId,
      snapshot: this.snapshotSession(session),
    });
  }

  private resizeBackend(
    session: TerminalManagerSession,
    size: TerminalSize,
    emit: EmitTerminalEvent,
  ): void {
    if (!session.backend || session.exited) return;
    try {
      session.backend.process.resize(size.cols, size.rows);
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : "Failed to resize terminal.";
      this.emitError(emit, session.sessionId, message);
    }
  }

  private rememberEmitter(
    webContentsId: number,
    emit: EmitTerminalEvent,
  ): void {
    this.fallbackEmittersByWebContentsId.set(webContentsId, emit);
  }

  private sendToLease(
    session: TerminalManagerSession,
    channel: TerminalEventName,
    payload: TerminalEventPayload,
  ): void {
    const lease = session.lease;
    if (!lease) return;
    this.sendToWebContentsId(lease.webContentsId, channel, payload);
  }

  private sendToWebContentsId(
    webContentsId: number,
    channel: TerminalEventName,
    payload: TerminalEventPayload,
  ): void {
    if (this.eventPublisher) {
      this.eventPublisher.sendToWebContentsId(webContentsId, channel, payload);
      return;
    }
    this.fallbackEmittersByWebContentsId.get(webContentsId)?.(channel, payload);
  }

  private broadcast(
    channel: TerminalEventName,
    payload: TerminalEventPayload,
  ): void {
    if (this.eventPublisher) {
      this.eventPublisher.broadcast(channel, payload);
      return;
    }
    for (const emit of new Set(this.fallbackEmittersByWebContentsId.values())) {
      emit(channel, payload);
    }
  }

  private linkSession(session: TerminalManagerSession): void {
    if (session.conversationId) {
      this.sessionByConversationId.set(session.conversationId, session.sessionId);
    }
    if (session.projectSessionId) {
      this.sessionByProjectSessionId.set(session.projectSessionId, session.sessionId);
    }
  }

  private unlinkSession(session: TerminalManagerSession): void {
    if (
      session.conversationId &&
      this.sessionByConversationId.get(session.conversationId) === session.sessionId
    ) {
      this.sessionByConversationId.delete(session.conversationId);
    }
    if (
      session.projectSessionId &&
      this.sessionByProjectSessionId.get(session.projectSessionId) === session.sessionId
    ) {
      this.sessionByProjectSessionId.delete(session.projectSessionId);
    }
  }

  private snapshotSession(session: TerminalManagerSession): TerminalSessionSnapshot {
    return {
      sessionId: session.sessionId,
      conversationId: session.conversationId,
      projectSessionId: session.projectSessionId,
      osPid: session.osPid,
      cpuPercent: session.cpuPercent,
      rssKb: session.rssKb,
      childProcessCount: session.childProcessCount,
      processMetricsSampledAtMs: session.processMetricsSampledAtMs,
      cwd: session.cwd,
      shell: session.shell,
      title: session.title,
      backendKind: session.backendKind,
      buffer: session.buffer,
      truncated: session.truncated,
      exited: session.exited,
      exitCode: session.exitCode,
      viewLease: session.lease
        ? {
            windowSessionId: session.lease.windowSessionId,
            generation: session.lease.generation,
            size: session.lease.size,
          }
        : null,
    };
  }
}

export const terminalManager = new TerminalManager();
