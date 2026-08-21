import { beforeEach, describe, expect, test, vi } from "vitest";

const ptyMock = vi.hoisted(() => ({
  spawn: vi.fn(),
}));

vi.mock("node-pty", () => ptyMock);

import { TerminalManager, resolveDefaultTerminalCommand } from "./terminal-manager";

interface FakePty {
  pid: number;
  write: ReturnType<typeof vi.fn>;
  resize: ReturnType<typeof vi.fn>;
  kill: ReturnType<typeof vi.fn>;
  emitData(data: string): void;
  emitExit(exitCode: number): void;
}

function makeFakePty(pid = 4242): FakePty {
  let onData: ((data: string) => void) | null = null;
  let onExit: ((event: { exitCode: number }) => void) | null = null;
  return {
    pid,
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    onData(callback: (data: string) => void) {
      onData = callback;
      return { dispose: vi.fn() };
    },
    onExit(callback: (event: { exitCode: number }) => void) {
      onExit = callback;
      return { dispose: vi.fn() };
    },
    emitData(data: string) {
      onData?.(data);
    },
    emitExit(exitCode: number) {
      onExit?.({ exitCode });
    },
  } as FakePty;
}

function owner(id: number): Electron.WebContents {
  return { id } as Electron.WebContents;
}

function makeHarness() {
  const manager = new TerminalManager();
  const directEvents: unknown[] = [];
  const targetedEvents: unknown[] = [];
  const broadcastEvents: unknown[] = [];
  manager.configureEventPublisher({
    broadcast: (channel, payload) => {
      broadcastEvents.push([channel, payload]);
    },
    sendToWebContentsId: (webContentsId, channel, payload) => {
      targetedEvents.push([webContentsId, channel, payload]);
    },
  });
  return {
    manager,
    directEvents,
    targetedEvents,
    broadcastEvents,
    emit: (channel: string, payload: unknown) => {
      directEvents.push([channel, payload]);
    },
  };
}

describe("resolveDefaultTerminalCommand", () => {
  test("starts zsh as an interactive login shell", () => {
    expect(resolveDefaultTerminalCommand("/bin/zsh", "darwin")).toEqual(["/bin/zsh", "-l", "-i"]);
  });

  test("starts bash with its login and interactive flags", () => {
    expect(resolveDefaultTerminalCommand("/bin/bash", "linux")).toEqual([
      "/bin/bash",
      "--login",
      "-i",
    ]);
  });

  test("starts unknown POSIX shells interactively without assuming login support", () => {
    expect(resolveDefaultTerminalCommand("/bin/sh", "linux")).toEqual(["/bin/sh", "-i"]);
  });

  test("does not add POSIX shell flags on Windows", () => {
    expect(resolveDefaultTerminalCommand("powershell.exe", "win32")).toEqual(["powershell.exe"]);
  });
});

describe("TerminalManager view leases", () => {
  beforeEach(() => {
    ptyMock.spawn.mockReset();
  });

  test("forwards local PTY output to the configured observer", () => {
    const fakePty = makeFakePty();
    ptyMock.spawn.mockReturnValue(fakePty);
    const harness = makeHarness();
    const observer = {
      observePtyData: vi.fn(),
    };
    harness.manager.configurePtyDataObserver(observer);

    harness.manager.create(
      owner(11),
      "window-session-a",
      {
        sessionId: "terminal-observed",
        cwd: process.cwd(),
        size: { cols: 80, rows: 24 },
      },
      harness.emit,
    );
    fakePty.emitData("server ready on http://localhost:3000");

    expect(observer.observePtyData).toHaveBeenCalledWith(
      "terminal-observed",
      "server ready on http://localhost:3000",
    );
  });

  test("returns a typed conflict and performs compare-and-swap takeover", () => {
    const fakePty = makeFakePty();
    ptyMock.spawn.mockReturnValue(fakePty);
    const harness = makeHarness();
    const firstOwner = owner(11);
    const secondOwner = owner(22);
    const request = {
      sessionId: "terminal-1",
      cwd: process.cwd(),
      size: { cols: 80, rows: 24 },
    };

    const created = harness.manager.create(firstOwner, "window-session-a", request, harness.emit);
    expect(created.status).toBe("acquired");

    const conflict = harness.manager.acquireViewLease(
      secondOwner,
      "window-session-b",
      request,
      harness.emit,
    );
    expect(conflict).toMatchObject({
      status: "conflict",
      generation: 1,
      ownerWindowSessionId: "window-session-a",
    });

    const stale = harness.manager.takeOverViewLease(
      secondOwner,
      "window-session-b",
      {
        sessionId: request.sessionId,
        expectedGeneration: 0,
        size: { cols: 100, rows: 30 },
      },
      harness.emit,
    );
    expect(stale).toMatchObject({
      status: "stale",
      generation: 1,
      ownerWindowSessionId: "window-session-a",
    });

    const taken = harness.manager.takeOverViewLease(
      secondOwner,
      "window-session-b",
      {
        sessionId: request.sessionId,
        expectedGeneration: 1,
        size: { cols: 100, rows: 30 },
      },
      harness.emit,
    );
    expect(taken).toMatchObject({
      status: "acquired",
      generation: 2,
    });
    expect(harness.targetedEvents).toContainEqual([
      11,
      "terminal-view-lease-revoked",
      {
        sessionId: "terminal-1",
        generation: 2,
        ownerWindowSessionId: "window-session-b",
      },
    ]);
    expect(fakePty.resize).toHaveBeenCalledWith(100, 30);

    harness.manager.write(
      firstOwner,
      "window-session-a",
      request.sessionId,
      "blocked",
      harness.emit,
    );
    harness.manager.write(
      secondOwner,
      "window-session-b",
      request.sessionId,
      "allowed",
      harness.emit,
    );
    expect(fakePty.write).toHaveBeenCalledTimes(1);
    expect(fakePty.write).toHaveBeenCalledWith("allowed");
  });

  test("releasing or destroying a renderer drops only its lease", () => {
    const fakePty = makeFakePty();
    ptyMock.spawn.mockReturnValue(fakePty);
    const harness = makeHarness();
    const renderer = owner(11);
    const request = {
      sessionId: "terminal-2",
      cwd: process.cwd(),
      size: { cols: 80, rows: 24 },
    };

    harness.manager.create(renderer, "window-session-a", request, harness.emit);
    harness.manager.releaseViewLease(renderer, "window-session-a", request.sessionId);

    expect(harness.manager.getSessionSnapshot(request.sessionId)?.viewLease).toBeNull();
    expect(fakePty.kill).not.toHaveBeenCalled();

    const reacquired = harness.manager.acquireViewLease(
      renderer,
      "window-session-a",
      request,
      harness.emit,
    );
    expect(reacquired).toMatchObject({ status: "acquired", generation: 2 });

    harness.manager.releaseLeasesForWebContents(renderer.id);
    expect(harness.manager.getSessionSnapshot(request.sessionId)?.viewLease).toBeNull();
    expect(fakePty.kill).not.toHaveBeenCalled();
  });

  test("keeps one PTY when a pre-thread Session later gains its Thread identity", () => {
    const fakePty = makeFakePty();
    ptyMock.spawn.mockReturnValue(fakePty);
    const harness = makeHarness();
    const renderer = owner(11);
    const request = {
      sessionId: "terminal-pre-thread",
      conversationId: null,
      projectSessionId: "session-default-draft",
      cwd: process.cwd(),
      size: { cols: 80, rows: 24 },
    };

    const created = harness.manager.create(renderer, "window-session-a", request, harness.emit);
    fakePty.emitData("draft shell\r\n");
    harness.manager.releaseViewLease(renderer, "window-session-a", request.sessionId);
    const attached = harness.manager.acquireViewLease(
      renderer,
      "window-session-a",
      {
        ...request,
        conversationId: "thread-started",
      },
      harness.emit,
    );

    expect(created).toMatchObject({
      status: "acquired",
      snapshot: { osPid: fakePty.pid },
    });
    expect(attached).toMatchObject({
      status: "acquired",
      snapshot: {
        osPid: fakePty.pid,
        conversationId: "thread-started",
        projectSessionId: "session-default-draft",
        buffer: "draft shell\r\n",
      },
    });
    expect(ptyMock.spawn).toHaveBeenCalledOnce();
    expect(fakePty.kill).not.toHaveBeenCalled();
    expect(harness.manager.getThreadSnapshot("thread-started")).toMatchObject({
      sessionId: "terminal-pre-thread",
      osPid: fakePty.pid,
    });
  });

  test("explicit kill and backend exit broadcast resource termination", () => {
    const killedPty = makeFakePty(100);
    const exitedPty = makeFakePty(200);
    ptyMock.spawn.mockReturnValueOnce(killedPty).mockReturnValueOnce(exitedPty);
    const harness = makeHarness();
    const renderer = owner(11);

    harness.manager.create(
      renderer,
      "window-session-a",
      {
        sessionId: "terminal-killed",
        cwd: process.cwd(),
        size: { cols: 80, rows: 24 },
      },
      harness.emit,
    );
    harness.manager.killSession("terminal-killed");
    expect(killedPty.kill).toHaveBeenCalledOnce();
    expect(harness.broadcastEvents).toContainEqual([
      "terminal-exit",
      {
        sessionId: "terminal-killed",
        exitCode: null,
        reason: "killed",
      },
    ]);

    harness.manager.create(
      renderer,
      "window-session-a",
      {
        sessionId: "terminal-exited",
        cwd: process.cwd(),
        size: { cols: 80, rows: 24 },
      },
      harness.emit,
    );
    exitedPty.emitExit(7);
    expect(harness.broadcastEvents).toContainEqual([
      "terminal-exit",
      {
        sessionId: "terminal-exited",
        exitCode: 7,
        reason: "exited",
      },
    ]);
    expect(harness.manager.getSessionSnapshot("terminal-exited")?.exited).toBe(true);
  });

  test("app shutdown kills every live PTY", () => {
    const first = makeFakePty(100);
    const second = makeFakePty(200);
    ptyMock.spawn.mockReturnValueOnce(first).mockReturnValueOnce(second);
    const harness = makeHarness();
    const renderer = owner(11);

    for (const sessionId of ["terminal-a", "terminal-b"]) {
      harness.manager.create(
        renderer,
        "window-session-a",
        {
          sessionId,
          cwd: process.cwd(),
          size: { cols: 80, rows: 24 },
        },
        harness.emit,
      );
    }
    harness.manager.killAll();

    expect(first.kill).toHaveBeenCalledOnce();
    expect(second.kill).toHaveBeenCalledOnce();
    expect(harness.manager.getSessionSnapshot("terminal-a")).toBeNull();
    expect(harness.manager.getSessionSnapshot("terminal-b")).toBeNull();
  });
});
