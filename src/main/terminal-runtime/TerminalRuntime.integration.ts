import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import { it } from "@effect/vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { TerminalSessions } from "./TerminalSessions";
import * as TerminalRuntimeLive from "./TerminalRuntimeLive";

const waitUntil = (predicate: Effect.Effect<boolean>, label: string) =>
  Effect.gen(function* () {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      if (yield* predicate) return;
      yield* Effect.sleep("25 millis");
    }
    return yield* Effect.die(new Error(`Timed out waiting for ${label}`));
  });

it.live.skipIf(process.platform === "win32")(
  "loads the Electron ABI and releases a real PTY through its session scope",
  () =>
    Effect.gen(function* () {
      const cwd = yield* Effect.acquireRelease(
        Effect.sync(() => mkdtempSync(path.join(tmpdir(), "nodex-native-pty-"))),
        (directory) => Effect.sync(() => rmSync(directory, { force: true, recursive: true })),
      );
      const context = yield* Layer.build(TerminalRuntimeLive.live);
      const sessions = Context.get(context, TerminalSessions);
      const output = yield* Ref.make("");
      yield* Effect.forkScoped(
        sessions.events.pipe(
          Stream.runForEach((event) =>
            event.channel === "terminal-data"
              ? Ref.update(output, (current) => current + event.payload.data)
              : Effect.void,
          ),
        ),
      );
      yield* Effect.yieldNow;

      const owner = { webContentsId: 41, windowSessionId: "terminal-native-window" };
      const sessionId = "terminal-native-contract";
      const created = yield* sessions.create(owner, {
        sessionId,
        cwd,
        size: { cols: 80, rows: 24 },
      });
      if (created.status !== "acquired") {
        return yield* Effect.die(new Error("Expected the native PTY lease to be acquired"));
      }
      if (typeof created.snapshot.osPid !== "number") {
        return yield* Effect.die(new Error("Expected a native PTY process id"));
      }

      yield* sessions.write(owner, sessionId, `printf '__NODEX_PTY_CWD__:%s\\n' "$PWD"\r`);
      yield* waitUntil(
        Ref.get(output).pipe(Effect.map((value) => value.includes(`__NODEX_PTY_CWD__:${cwd}`))),
        "PTY cwd output",
      );
      yield* sessions.write(owner, sessionId, "exit\r");
      yield* waitUntil(
        sessions
          .getSessionSnapshot(sessionId)
          .pipe(Effect.map((snapshot) => snapshot?.exited === true)),
        "PTY exit",
      );
    }),
);
