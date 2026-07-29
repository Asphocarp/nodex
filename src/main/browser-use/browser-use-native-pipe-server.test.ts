import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  BrowserUseNativePipeFrameDecoder,
  encodeBrowserUseNativePipeFrame,
} from "./native-pipe-framing";
import {
  BrowserUseNativePipeServer,
  type BrowserUseNativePipeServerEvents,
} from "./browser-use-native-pipe-server";

const servers: BrowserUseNativePipeServer[] = [];
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(async (server) => {
    await server.close();
  }));
  await Promise.all(temporaryDirectories.splice(0).map(async (directory) => {
    await fs.rm(directory, { recursive: true, force: true });
  }));
});

async function makeServer(
  authorized: boolean,
  handler: ConstructorParameters<typeof BrowserUseNativePipeServer>[0]["handler"],
  events?: BrowserUseNativePipeServerEvents,
) {
  const temporaryRoot = process.platform === "win32" ? os.tmpdir() : "/tmp";
  const directory = await fs.mkdtemp(path.join(temporaryRoot, "nxbu-"));
  temporaryDirectories.push(directory);
  const server = new BrowserUseNativePipeServer({
    events,
    handler,
    nativePipeDirectory: directory,
    socketPeerAuthorizer: () => ({
      authorized,
      ...(!authorized ? { reason: "test-denied" } : {}),
    }),
  });
  servers.push(server);
  await server.start();
  return server;
}

function connect(pipePath: string): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(pipePath);
    socket.once("connect", () => resolve(socket));
    socket.once("error", reject);
  });
}

function readOne(socket: net.Socket): Promise<Record<string, unknown>> {
  const decoder = new BrowserUseNativePipeFrameDecoder();
  return new Promise((resolve, reject) => {
    socket.on("data", (chunk) => {
      try {
        const [message] = decoder.push(chunk);
        if (message) resolve(JSON.parse(message) as Record<string, unknown>);
      } catch (error) {
        reject(error);
      }
    });
    socket.once("error", reject);
  });
}

describe("BrowserUseNativePipeServer", () => {
  test.runIf(process.platform !== "win32")(
    "authorizes before reading and returns isolated JSON-RPC responses",
    async () => {
      const server = await makeServer(true, (request, context) => ({
        connectionId: context.connectionId,
        method: request.method,
      }));
      const [first, second] = await Promise.all([
        connect(server.pipePath),
        connect(server.pipePath),
      ]);
      const firstResponse = readOne(first);
      const secondResponse = readOne(second);
      first.write(encodeBrowserUseNativePipeFrame(JSON.stringify({
        jsonrpc: "2.0",
        id: "same-id",
        method: "ping",
      })));
      second.write(encodeBrowserUseNativePipeFrame(JSON.stringify({
        jsonrpc: "2.0",
        id: "same-id",
        method: "getInfo",
      })));

      const [firstMessage, secondMessage] = await Promise.all([
        firstResponse,
        secondResponse,
      ]);
      expect(firstMessage.id).toBe("same-id");
      expect(secondMessage.id).toBe("same-id");
      expect((firstMessage.result as { method: string }).method).toBe("ping");
      expect((secondMessage.result as { method: string }).method).toBe("getInfo");
      expect(
        (firstMessage.result as { connectionId: string }).connectionId,
      ).not.toBe((secondMessage.result as { connectionId: string }).connectionId);
      first.destroy();
      second.destroy();
    },
  );

  test.runIf(process.platform !== "win32")(
    "rejects unauthorized peers without dispatching a request",
    async () => {
      let calls = 0;
      const server = await makeServer(false, () => {
        calls += 1;
      });
      const socket = await connect(server.pipePath);
      socket.write(encodeBrowserUseNativePipeFrame(JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "ping",
      })));
      await new Promise<void>((resolve) => socket.once("close", () => resolve()));
      expect(calls).toBe(0);
    },
  );

  test.runIf(process.platform !== "win32")(
    "uses restrictive directory and socket permissions",
    async () => {
      const server = await makeServer(true, () => "pong");
      const directoryMode = (await fs.stat(path.dirname(server.pipePath))).mode & 0o777;
      const socketMode = (await fs.stat(server.pipePath)).mode & 0o777;
      expect(directoryMode).toBe(0o700);
      expect(socketMode).toBe(0o600);
    },
  );

  test.runIf(process.platform !== "win32")(
    "reports bounded request lifecycle metadata without request parameters",
    async () => {
      const started: unknown[] = [];
      const completed: unknown[] = [];
      const server = await makeServer(
        true,
        () => "ok",
        {
          onRequestCompleted: (event) => completed.push(event),
          onRequestStarted: (event) => started.push(event),
        },
      );
      const socket = await connect(server.pipePath);
      const response = readOne(socket);
      socket.write(encodeBrowserUseNativePipeFrame(JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "executeCdp",
        params: {
          method: "Page.navigate",
          params: { url: "https://private.example/path" },
          tabId: 1,
        },
      })));

      await expect(response).resolves.toMatchObject({ id: 1, result: "ok" });
      expect(started).toEqual([expect.objectContaining({
        label: "executeCdp:Page.navigate",
        notification: false,
      })]);
      expect(completed).toEqual([expect.objectContaining({
        label: "executeCdp:Page.navigate",
        notification: false,
        outcome: "success",
      })]);
      expect(JSON.stringify({ started, completed })).not.toContain("private.example");
      socket.destroy();
    },
  );
});
