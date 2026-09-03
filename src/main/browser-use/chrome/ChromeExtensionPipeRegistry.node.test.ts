import fs from "node:fs/promises";
import net, { type Server } from "node:net";
import path from "node:path";
import { afterEach, describe, expect, test } from "vite-plus/test";
import {
  BrowserUseNativePipeFrameDecoder,
  encodeBrowserUseNativePipeFrame,
} from "../native-pipe-framing";
import { ChromeExtensionPipeRegistry } from "./ChromeExtensionPipeRegistry";
import { TEST_CHROME_AUTHORITY } from "./chrome-test-fixture";

const roots: string[] = [];
const servers: Server[] = [];
const peerIdentity = { signingIdentifier: "com.openai.chrome-host", teamId: "TESTTEAM" };
const authorizePeer = () => ({ authorized: true, ...peerIdentity });

afterEach(async () => {
  for (const server of servers.splice(0)) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { force: true, recursive: true })));
});

interface FakeBackendOptions {
  readonly extensionId?: string;
  readonly extensionInstanceId?: string;
  readonly family?: string;
  readonly type?: "extension" | "iab";
}

async function makeBackend(
  directory: string,
  name: string,
  options: FakeBackendOptions,
  requests: Array<{ readonly method: string; readonly params: unknown }>,
): Promise<string> {
  const socketPath = path.join(directory, name);
  const server = net.createServer((socket) => {
    const decoder = new BrowserUseNativePipeFrameDecoder();
    socket.on("data", (chunk) => {
      for (const message of decoder.push(chunk)) {
        const request = JSON.parse(message) as {
          id: number;
          method: string;
          params: unknown;
        };
        requests.push({ method: request.method, params: request.params });
        const result =
          request.method === "getInfo"
            ? {
                family: options.family ?? "chrome",
                metadata: {
                  extensionId: options.extensionId ?? "hehggadaopoacecdllhhajmbjkdcmajg",
                  extensionInstanceId: options.extensionInstanceId ?? "instance-1",
                },
                type: options.type ?? "extension",
              }
            : {};
        socket.write(
          encodeBrowserUseNativePipeFrame(
            JSON.stringify({ jsonrpc: "2.0", id: request.id, result }),
          ),
        );
      }
    });
  });
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => resolve());
  });
  await fs.chmod(socketPath, 0o600);
  return socketPath;
}

async function makeDirectory(): Promise<string> {
  const directory = await fs.mkdtemp(path.join("/tmp", "nodex-chrome-pipes-"));
  roots.push(directory);
  await fs.chmod(directory, 0o700);
  return directory;
}

describe("Chrome extension pipe registry", () => {
  test("admits only allowlisted extension endpoints and focuses the exact instance", async () => {
    if (process.platform === "win32") return;
    const directory = await makeDirectory();
    const requests: Array<{ readonly method: string; readonly params: unknown }> = [];
    await makeBackend(directory, "extension.sock", { extensionInstanceId: "profile-a" }, requests);
    await makeBackend(directory, "iab.sock", { type: "iab" }, requests);
    await makeBackend(
      directory,
      "unknown-extension.sock",
      { extensionId: "unknown", extensionInstanceId: "profile-b" },
      requests,
    );
    const registry = new ChromeExtensionPipeRegistry({
      authority: TEST_CHROME_AUTHORITY,
      directory,
      expectedPeerIdentity: peerIdentity,
      healthCheckIntervalMs: 60_000,
      requestTimeoutMs: 500,
      socketPeerAuthorizer: authorizePeer,
    });

    const snapshot = await registry.start();
    expect(snapshot).toEqual({
      instances: [
        {
          extensionId: "hehggadaopoacecdllhhajmbjkdcmajg",
          extensionInstanceId: "profile-a",
          family: "chrome",
        },
      ],
      providerReady: true,
      revision: 1,
    });

    await registry.focusPresentation({
      extensionInstanceId: "profile-a",
      sessionId: "thread-1",
      tabId: "42",
    });
    expect(requests.at(-2)).toEqual({
      method: "getInfo",
      params: { session_id: "thread-1", turn_id: "pip-focus" },
    });
    expect(requests.at(-1)).toEqual({
      method: "focusTab",
      params: { session_id: "thread-1", tabId: 42 },
    });
    registry.stop();
  });

  test("fails closed for duplicate instance identities and unsafe tab ids", async () => {
    if (process.platform === "win32") return;
    const directory = await makeDirectory();
    const requests: Array<{ readonly method: string; readonly params: unknown }> = [];
    await makeBackend(directory, "first.sock", { extensionInstanceId: "duplicate" }, requests);
    await makeBackend(directory, "second.sock", { extensionInstanceId: "duplicate" }, requests);
    const diagnostics: string[] = [];
    const registry = new ChromeExtensionPipeRegistry({
      authority: TEST_CHROME_AUTHORITY,
      directory,
      expectedPeerIdentity: peerIdentity,
      healthCheckIntervalMs: 60_000,
      onDiagnostic: ({ code }) => diagnostics.push(code),
      requestTimeoutMs: 500,
      socketPeerAuthorizer: authorizePeer,
    });

    expect(await registry.refresh()).toEqual({ instances: [], providerReady: false, revision: 0 });
    expect(diagnostics).toContain("duplicate-extension-instance");
    await expect(
      registry.focusPresentation({
        extensionInstanceId: "duplicate",
        sessionId: "thread-1",
        tabId: "NaN",
      }),
    ).rejects.toThrow("tab id is invalid");
  });

  test("treats a missing controlled directory as a healthy disconnected provider", async () => {
    const directory = path.join("/tmp", `nodex-chrome-missing-${process.pid}-${Date.now()}`);
    const registry = new ChromeExtensionPipeRegistry({
      authority: TEST_CHROME_AUTHORITY,
      directory,
      expectedPeerIdentity: peerIdentity,
      socketPeerAuthorizer: authorizePeer,
    });
    expect(await registry.refresh()).toEqual({ instances: [], providerReady: false, revision: 0 });
  });

  test("rejects a same-UID fake socket before sending getInfo", async () => {
    if (process.platform === "win32") return;
    const directory = await makeDirectory();
    const requests: Array<{ readonly method: string; readonly params: unknown }> = [];
    await makeBackend(directory, "fake.sock", { extensionInstanceId: "forged" }, requests);
    const registry = new ChromeExtensionPipeRegistry({
      authority: TEST_CHROME_AUTHORITY,
      directory,
      expectedPeerIdentity: peerIdentity,
      requestTimeoutMs: 500,
      socketPeerAuthorizer: () => ({ authorized: false, reason: "unsigned-peer" }),
    });

    expect(await registry.refresh()).toEqual({ instances: [], providerReady: false, revision: 0 });
    expect(requests).toEqual([]);
  });

  test("rejects an authorized peer whose signed native-host identity does not match", async () => {
    if (process.platform === "win32") return;
    const directory = await makeDirectory();
    const requests: Array<{ readonly method: string; readonly params: unknown }> = [];
    await makeBackend(directory, "wrong-team.sock", {}, requests);
    const registry = new ChromeExtensionPipeRegistry({
      authority: TEST_CHROME_AUTHORITY,
      directory,
      expectedPeerIdentity: peerIdentity,
      requestTimeoutMs: 500,
      socketPeerAuthorizer: () => ({
        authorized: true,
        signingIdentifier: peerIdentity.signingIdentifier,
        teamId: "OTHERTEAM",
      }),
    });

    expect(await registry.refresh()).toEqual({ instances: [], providerReady: false, revision: 0 });
    expect(requests).toEqual([]);
  });
});
