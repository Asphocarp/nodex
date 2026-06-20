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
} from "../shared/types";

export const TERMINAL_BUFFER_LIMIT = 16_000;

type TerminalEventName =
  | "terminal-data"
  | "terminal-init-log"
  | "terminal-attached"
  | "terminal-error"
  | "terminal-exit";

type TerminalEventPayload =
  | { sessionId: string; data: string }
  | { sessionId: string; data: string; snapshot: TerminalSessionSnapshot }
  | { sessionId: string; snapshot: TerminalSessionSnapshot }
  | { sessionId: string; message: string }
  | { sessionId: string; exitCode: number | null };

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
  ownerWebContentsId: number;
  conversationId: string | null;
  projectSessionId: string | null;
  cwd: string | null;
  shell: string | null;
  title: string | null;
  backendKind: TerminalBackendKind;
  backend: TerminalBackendHandle | null;
  attached: boolean;
  buffer: string;
  truncated: boolean;
  exited: boolean;
  exitCode: number | null;
  lastSize: TerminalSize;
  pendingAction: Promise<void> | null;
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

function appendBoundedBuffer(
  current: string,
  incoming: string,
): { buffer: string; truncated: boolean } {
  const next = `${current}${incoming}`;
  if (next.length <= TERMINAL_BUFFER_LIMIT) {
    return { buffer: next, truncated: false };
  }

  return {
    buffer: next.slice(next.length - TERMINAL_BUFFER_LIMIT),
    truncated: true,
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

  create(
    owner: Electron.WebContents,
    request: TerminalCreateRequest,
    emit: EmitTerminalEvent,
  ): void {
    const existing = this.sessionsById.get(request.sessionId);
    if (existing) {
      this.attach(owner, request, emit);
      return;
    }

    if (request.backendKind === "remote") {
      this.emitError(
        emit,
        request.sessionId,
        "Remote terminal backend is not available in this Nodex build.",
      );
      return;
    }

    const size = normalizeSize(request.size);
    const cwd = resolveTerminalCwd(request.cwd);
    const shell = getDefaultShell();
    const session: TerminalManagerSession = {
      sessionId: request.sessionId,
      ownerWebContentsId: owner.id,
      conversationId: request.conversationId ?? null,
      projectSessionId: request.projectSessionId ?? null,
      cwd,
      shell,
      title: request.title ?? null,
      backendKind: request.backendKind ?? "local",
      backend: null,
      attached: false,
      buffer: "",
      truncated: false,
      exited: false,
      exitCode: null,
      lastSize: size,
      pendingAction: null,
    };

    this.sessionsById.set(session.sessionId, session);
    this.linkSession(session);

    const spawned = this.spawnLocalBackend(session, size, emit);
    if (!spawned) {
      this.unlinkSession(session);
      this.sessionsById.delete(session.sessionId);
      return;
    }

    this.flushInit(session, emit, true);
    this.sendAttached(session, emit);
  }

  attach(
    owner: Electron.WebContents,
    request: TerminalAttachRequest,
    emit: EmitTerminalEvent,
  ): void {
    const session = this.sessionsById.get(request.sessionId);
    if (!session) {
      this.create(
        owner,
        {
          sessionId: request.sessionId,
          conversationId: request.conversationId,
          projectSessionId: request.projectSessionId,
          cwd: request.cwd,
          size: request.size,
        },
        emit,
      );
      return;
    }

    if (!this.ensureOwner(owner, session, emit)) return;

    session.conversationId = request.conversationId ?? session.conversationId;
    session.projectSessionId = request.projectSessionId ?? session.projectSessionId;
    session.lastSize = normalizeSize(request.size);
    this.linkSession(session);

    if (session.backend) {
      this.resize(owner, session.sessionId, session.lastSize, emit);
    }

    this.flushInit(session, emit);
    this.sendAttached(session, emit);
  }

  write(
    owner: Electron.WebContents,
    sessionId: string,
    data: string,
    emit: EmitTerminalEvent,
  ): void {
    const session = this.sessionsById.get(sessionId);
    if (!session) {
      this.emitError(emit, sessionId, "Terminal session does not exist.");
      return;
    }

    if (!this.ensureOwner(owner, session, emit)) return;
    if (!session.backend || session.exited) {
      this.emitError(emit, sessionId, "Terminal session is not running.");
      return;
    }

    session.backend.process.write(data);
  }

  resize(
    owner: Electron.WebContents,
    sessionId: string,
    size: TerminalSize,
    emit: EmitTerminalEvent,
  ): void {
    const session = this.sessionsById.get(sessionId);
    if (!session) return;
    if (!this.ensureOwner(owner, session, emit)) return;

    const normalizedSize = normalizeSize(size);
    if (
      normalizedSize.cols === session.lastSize.cols &&
      normalizedSize.rows === session.lastSize.rows
    ) {
      return;
    }

    session.lastSize = normalizedSize;
    if (!session.backend || session.exited) return;

    try {
      session.backend.process.resize(normalizedSize.cols, normalizedSize.rows);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to resize terminal.";
      this.emitError(emit, sessionId, message);
    }
  }

  close(owner: Electron.WebContents, sessionId: string, emit: EmitTerminalEvent): void {
    const session = this.sessionsById.get(sessionId);
    if (!session) return;
    if (!this.ensureOwner(owner, session, emit)) return;

    this.disposeBackend(session, true);
    this.unlinkSession(session);
    this.sessionsById.delete(sessionId);
  }

  async runAction(
    owner: Electron.WebContents,
    request: TerminalRunActionRequest,
    emit: EmitTerminalEvent,
  ): Promise<void> {
    const session = this.sessionsById.get(request.sessionId);
    if (!session) {
      this.create(
        owner,
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
      this.write(owner, request.sessionId, commandWithNewline(request.command), emit);
      return;
    }

    if (!this.ensureOwner(owner, session, emit)) return;

    const previousAction = session.pendingAction ?? Promise.resolve();
    const nextAction = previousAction
      .catch(() => undefined)
      .then(() => this.restartForAction(owner, session, request, emit));
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
    session: TerminalManagerSession,
    request: TerminalRunActionRequest,
    emit: EmitTerminalEvent,
  ): Promise<void> {
    if (!this.ensureOwner(owner, session, emit)) return;

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
    session.attached = false;
    session.lastSize = normalizeSize(request.size ?? session.lastSize);
    this.linkSession(session);

    if (!this.spawnLocalBackend(session, session.lastSize, emit)) return;

    this.flushInit(session, emit, true);
    this.sendAttached(session, emit);
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
        if (session.attached) {
          emit("terminal-data", { sessionId: session.sessionId, data });
        }
      });

      const onExitDisposable = proc.onExit(({ exitCode }) => {
        session.exited = true;
        session.exitCode = typeof exitCode === "number" ? exitCode : null;
        this.disposeBackend(session, false);
        emit("terminal-exit", {
          sessionId: session.sessionId,
          exitCode: session.exitCode,
        });
      });

      session.backend = { process: proc, onDataDisposable, onExitDisposable };
      session.exited = false;
      session.exitCode = null;
      session.cwd = cwd;
      session.shell = shell;

      logger.info("Terminal session spawned", {
        sessionId: session.sessionId,
        ownerWebContentsId: session.ownerWebContentsId,
        cwd,
        shell,
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

  private ensureOwner(
    owner: Electron.WebContents,
    session: TerminalManagerSession,
    emit: EmitTerminalEvent,
  ): boolean {
    if (session.ownerWebContentsId === owner.id) return true;

    this.emitError(
      emit,
      session.sessionId,
      "Terminal session is owned by another window.",
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
    emit: EmitTerminalEvent,
    force = false,
  ): void {
    if (force || session.buffer.length > 0) {
      emit("terminal-init-log", {
        sessionId: session.sessionId,
        data: session.buffer,
        snapshot: this.snapshotSession(session),
      });
    }
    session.attached = true;
  }

  private sendAttached(
    session: TerminalManagerSession,
    emit: EmitTerminalEvent,
  ): void {
    emit("terminal-attached", {
      sessionId: session.sessionId,
      snapshot: this.snapshotSession(session),
    });
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
      cwd: session.cwd,
      shell: session.shell,
      title: session.title,
      backendKind: session.backendKind,
      buffer: session.buffer,
      truncated: session.truncated,
      exited: session.exited,
      exitCode: session.exitCode,
    };
  }
}

export const terminalManager = new TerminalManager();
