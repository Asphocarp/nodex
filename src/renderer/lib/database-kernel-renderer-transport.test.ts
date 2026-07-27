import { describe, expect, test } from "vitest";
import { createElectronRendererTransport } from "./electron-renderer-transport";

describe("Database event renderer IPC", () => {
  test("subscribes and filters the scoped projection contract", async () => {
    const projection = {
      listener: null as ((...args: unknown[]) => void) | null,
    };
    const invocations: Array<{ channel: string; args: unknown[] }> = [];
    const bridge = {
      invoke: async (channel: string, ...args: unknown[]) => {
        invocations.push({ channel, args });
      },
      on: (channel: string, listener: (...args: unknown[]) => void) => {
        if (channel === "projection-stream:message") projection.listener = listener;
        return () => {
          projection.listener = null;
        };
      },
    };
    const transport = createElectronRendererTransport(bridge as never);
    const scope = {
      kind: "project" as const,
      libraryId: "library-1",
      projectId: "project-1",
    };
    const messages: unknown[] = [];
    const release = transport.subscribeProjectionStream(
      scope,
      (message) => messages.push(message),
    );
    await Promise.resolve();
    const message = {
      version: 1 as const,
      kind: "checkpoint" as const,
      scope,
      cursor: { storeEpoch: "epoch-1", changeLogSeq: 7 },
    };
    projection.listener?.(message);
    projection.listener?.({
      ...message,
      scope: { ...scope, projectId: "project-2" },
    });
    release();
    await Promise.resolve();

    expect(messages).toEqual([message]);
    expect(invocations).toEqual([
      { channel: "projection-stream:subscribe", args: [scope] },
      { channel: "projection-stream:unsubscribe", args: [scope] },
    ]);
  });
});
