import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vite-plus/test";
import { TEST_CHROME_AUTHORITY, TEST_CHROME_HOST_NAME } from "./chrome-test-fixture";
import {
  installChromeNativeHost,
  readChromeNativeHostIdentity,
  type ChromeNativeHostInstallerOptions,
} from "./ChromeNativeHostInstaller";

const temporaryRoots: string[] = [];
const peerIdentity = { signingIdentifier: "com.openai.chrome-host", teamId: "TESTTEAM1A" };

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => fs.rm(root, { force: true, recursive: true })),
  );
});

async function makeRuntimeFile(root: string, name: string, executable: boolean): Promise<string> {
  const filePath = path.join(root, name);
  await fs.writeFile(filePath, name, { mode: executable ? 0o700 : 0o600 });
  return filePath;
}

async function makeInstallerOptions(root: string): Promise<ChromeNativeHostInstallerOptions> {
  const runtimeRoot = path.join(root, "packaged", "Resources", "browser-runtime");
  await fs.mkdir(runtimeRoot, { recursive: true });
  const runtimePaths = {
    browserClientPath: await makeRuntimeFile(runtimeRoot, "browser-client.mjs", false),
    codexCliPath: await makeRuntimeFile(runtimeRoot, "codex", true),
    nativeHostPath: await makeRuntimeFile(runtimeRoot, "ChatGPT for Chrome", true),
    nodePath: await makeRuntimeFile(runtimeRoot, "node", true),
    nodeReplPath: await makeRuntimeFile(runtimeRoot, "node-repl.mjs", false),
  };
  const nativeHostBytes = await fs.readFile(runtimePaths.nativeHostPath);
  return {
    authority: TEST_CHROME_AUTHORITY,
    channel: "prod",
    expectedNativeHost: {
      sha256: createHash("sha256").update(nativeHostBytes).digest("hex"),
      signingTeamId: peerIdentity.teamId,
      size: nativeHostBytes.byteLength,
    },
    homeDirectory: path.join(root, "home"),
    runtimePaths,
    runtimeStateHome: path.join(root, "profile", "agent"),
    verifyNativeHost: async () => peerIdentity,
  };
}

describe("Chrome native host installer", () => {
  test("installs manifests against a verified Profile-owned native-host closure", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "nodex-chrome-install-"));
    temporaryRoots.push(root);
    const options = await makeInstallerOptions(root);
    const verifiedPaths: string[] = [];

    const result = await installChromeNativeHost({
      ...options,
      verifyNativeHost: async (nativeHostPath) => {
        verifiedPaths.push(nativeHostPath);
        return peerIdentity;
      },
    });

    const expectedClosure = path.join(
      await fs.realpath(options.runtimeStateHome),
      "chrome-control",
      "native-host-v1",
      options.expectedNativeHost.sha256,
    );
    expect(result.nativeHostPath).toBe(path.join(expectedClosure, "native-host"));
    expect(result.nativeHostPath).not.toBe(options.runtimePaths.nativeHostPath);
    expect(result.configPath).toBe(path.join(expectedClosure, "extension-host-config.json"));
    expect(result.peerIdentity).toEqual(peerIdentity);
    expect(verifiedPaths).toEqual([
      options.runtimePaths.nativeHostPath,
      result.nativeHostPath,
      result.nativeHostPath,
    ]);
    expect(await fs.readdir(path.dirname(options.runtimePaths.nativeHostPath))).toEqual([
      "ChatGPT for Chrome",
      "browser-client.mjs",
      "codex",
      "node",
      "node-repl.mjs",
    ]);

    const config = JSON.parse(await fs.readFile(result.configPath, "utf8")) as Record<
      string,
      unknown
    >;
    expect(config).toEqual({
      browserClientPath: options.runtimePaths.browserClientPath,
      channel: "prod",
      codexCliPath: options.runtimePaths.codexCliPath,
      nodePath: options.runtimePaths.nodePath,
      nodeReplPath: options.runtimePaths.nodeReplPath,
      proxyHost: "127.0.0.1",
      proxyPort: 0,
      schemaVersion: 1,
    });
    expect(result.manifestPaths).toHaveLength(2);
    const manifest = JSON.parse(await fs.readFile(result.manifestPaths[0]!, "utf8")) as Record<
      string,
      unknown
    >;
    expect(manifest).toEqual({
      allowed_origins: TEST_CHROME_AUTHORITY.extensionIds.map(
        (extensionId) => `chrome-extension://${extensionId}/`,
      ),
      description: "Nodex browser native messaging host",
      name: TEST_CHROME_HOST_NAME,
      path: result.nativeHostPath,
      type: "stdio",
    });
    expect((await fs.stat(result.nativeHostPath)).mode & 0o777).toBe(0o700);
    expect((await fs.stat(result.configPath)).mode & 0o777).toBe(0o600);
    expect((await fs.stat(result.manifestPaths[0]!)).mode & 0o777).toBe(0o644);

    const second = await installChromeNativeHost(options);
    expect(second).toEqual(result);
  });

  test("fails closed before writing when the packaged native host is rejected", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "nodex-chrome-reject-"));
    temporaryRoots.push(root);
    const options = await makeInstallerOptions(root);

    await expect(
      installChromeNativeHost({
        ...options,
        verifyNativeHost: async () => {
          throw new Error("wrong signing team");
        },
      }),
    ).rejects.toThrow("wrong signing team");
    await expect(fs.stat(options.homeDirectory)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.stat(options.runtimeStateHome)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("rejects a symlink in the controlled destination chain", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "nodex-chrome-symlink-"));
    temporaryRoots.push(root);
    const options = await makeInstallerOptions(root);
    const outside = path.join(root, "outside");
    await fs.mkdir(options.runtimeStateHome, { mode: 0o700, recursive: true });
    await fs.mkdir(outside, { mode: 0o700 });
    await fs.symlink(outside, path.join(options.runtimeStateHome, "chrome-control"));

    await expect(installChromeNativeHost(options)).rejects.toThrow("not a regular directory");
    expect(await fs.readdir(outside)).toEqual([]);
  });

  test("parses the exact code-signing identity reported by codesign", () => {
    const identity = readChromeNativeHostIdentity("/runtime/native-host", (command, args) => {
      expect(command).toBe("/usr/bin/codesign");
      expect(args).toEqual(["-dv", "--verbose=4", "/runtime/native-host"]);
      return [
        "Executable=/runtime/native-host",
        "Identifier=com.openai.chrome-host",
        "TeamIdentifier=TESTTEAM1A",
      ].join("\n");
    });

    expect(identity).toEqual(peerIdentity);
  });
});
