import { describe, expect, test, vi } from "vite-plus/test";
import {
  registerCodexHooksIpcHandlers,
  type CodexHooksIpcChannel,
  type CodexHooksIpcHandler,
} from "./codex-hooks-ipc-handlers";

type RegisteredHandler = (event: unknown, input: never) => Promise<unknown> | unknown;

function createHarness() {
  const handlers = new Map<CodexHooksIpcChannel, RegisteredHandler>();
  const listHooks = vi.fn(async () => ({ data: [] }));
  const updateHooksState = vi.fn(async () => undefined);
  const broadcastHooksChanged = vi.fn();

  registerCodexHooksIpcHandlers({
    registerHandle: <Channel extends CodexHooksIpcChannel>(
      channel: Channel,
      listener: CodexHooksIpcHandler<Channel>,
    ) => {
      handlers.set(channel, listener as RegisteredHandler);
    },
    listHooks,
    updateHooksState,
    broadcastHooksChanged,
  });

  const invoke = async (channel: CodexHooksIpcChannel, input: unknown) => {
    const handler = handlers.get(channel);
    if (!handler) throw new Error(`Missing handler: ${channel}`);
    return await handler(null, input as never);
  };

  return { broadcastHooksChanged, invoke, listHooks, updateHooksState };
}

describe("Codex hooks IPC", () => {
  test("forwards list input and broadcasts the host only after a successful write", async () => {
    const harness = createHarness();
    const listInput = { hostId: "default", cwds: ["/workspace"] };
    const updateInput = {
      hostId: "default",
      patches: [{ key: "hook-1", enabled: false }],
    };

    await expect(harness.invoke("codex:hooks:list", listInput)).resolves.toEqual({ data: [] });
    await expect(harness.invoke("codex:hooks:state:update", updateInput)).resolves.toBeUndefined();

    expect(harness.listHooks).toHaveBeenCalledWith(listInput);
    expect(harness.updateHooksState).toHaveBeenCalledWith(updateInput);
    expect(harness.broadcastHooksChanged).toHaveBeenCalledWith({ hostId: "default" });
  });

  test("does not broadcast when the app-server write fails", async () => {
    const harness = createHarness();
    harness.updateHooksState.mockRejectedValueOnce(new Error("write failed"));

    await expect(
      harness.invoke("codex:hooks:state:update", {
        hostId: "default",
        patches: [{ key: "hook-1", enabled: true }],
      }),
    ).rejects.toThrow("write failed");

    expect(harness.broadcastHooksChanged).not.toHaveBeenCalled();
  });
});
