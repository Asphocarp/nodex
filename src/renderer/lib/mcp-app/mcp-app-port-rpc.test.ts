import { describe, expect, test } from "vite-plus/test";
import { createMcpAppHostHandlerPort, createMcpAppPortCall } from "./mcp-app-port-rpc";

describe("MCP App port RPC", () => {
  test("resolves a host call over a per-call reply channel", async () => {
    const port = createMcpAppHostHandlerPort(async (input) => ({ input }));
    const call = createMcpAppPortCall(port);

    await expect(call("fixture")).resolves.toEqual({ input: "fixture" });
    port.close();
  });

  test("serializes safe error fields without a stack", async () => {
    const port = createMcpAppHostHandlerPort(() => {
      const error = new Error("denied");
      Object.assign(error, { code: -32_601 });
      throw error;
    });
    const call = createMcpAppPortCall(port);

    await expect(call(undefined)).rejects.toMatchObject({
      message: "denied",
      code: -32_601,
    });
    port.close();
  });

  test("aborts a pending call", async () => {
    const channel = new MessageChannel();
    channel.port1.start();
    const controller = new AbortController();
    const call = createMcpAppPortCall(channel.port2, controller.signal);
    const pending = call(undefined, { timeoutMs: null });
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    channel.port1.close();
    channel.port2.close();
  });
});
