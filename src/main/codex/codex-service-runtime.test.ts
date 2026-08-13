import { describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CodexService } from "./codex-service";
import type { ResolvedCodexRuntime } from "./codex-runtime";
import { parse as parseToml } from "smol-toml";

function localClientOf<T>(service: CodexService): T {
  const router = Reflect.get(service, "client") as {
    clientForHost: (hostId: string) => unknown;
  };
  return router.clientForHost("local") as T;
}

describe("codex-service runtime bootstrap", () => {
  test("passes the resolved runtime into the Codex app-server client", async () => {
    const runtime: ResolvedCodexRuntime = {
      source: "bundled",
      binaryPath: "/tmp/nodex/codex",
      browserRuntime: {
        message: "Browser runtime is not installed",
        reason: "manifest-missing",
        status: "unavailable",
      },
      additionalSearchPaths: ["/tmp/nodex/path"],
      codexCompatibilityVersion: "0.146.0",
      metadataPath: "/tmp/nodex/agent-runtime.json",
      missingBinaryMessage: "Bundled agent runtime is missing or corrupted. Reinstall Nodex.",
      runtimeFamily: "open-interpreter",
      rootPath: "/tmp/nodex",
      version: "0.115.0",
    };
    const service = new CodexService({ runtime });

    try {
      const client = localClientOf<{
        additionalSearchPaths: string[];
        binaryPath: string;
        missingBinaryMessage: string;
      }>(service);
      expect(client.binaryPath).toBe(runtime.binaryPath);
      expect(client.additionalSearchPaths[0]).toBe(runtime.additionalSearchPaths[0]);
      expect(client.missingBinaryMessage).toBe(runtime.missingBinaryMessage);
    } finally {
      await service.shutdown();
    }
  });

  test("defers default runtime validation until the app-server client starts", async () => {
    const previousCwd = process.cwd();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-codex-service-runtime-"));

    process.chdir(tempDir);

    try {
      const service = new CodexService();

      try {
        const client = localClientOf<{
          additionalSearchPaths: string[];
          binaryPath: string;
          missingBinaryMessage: string;
        }>(service);
        const expectedRuntimeRootSuffix = path.join(".generated", "codex-runtime", "agent-runtime");
        expect(client.binaryPath.endsWith(
          path.join(expectedRuntimeRootSuffix, "bin", "interpreter"),
        )).toBe(true);
        expect((client.additionalSearchPaths[0] ?? "").endsWith(
          path.join(expectedRuntimeRootSuffix, "codex-path"),
        )).toBe(true);
        expect(client.missingBinaryMessage).toBe(
          "Pinned agent runtime is missing or incomplete. Run `pnpm run stage:codex-runtime:mac`.",
        );
      } finally {
        await service.shutdown();
      }
    } finally {
      process.chdir(previousCwd);
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("isolates writable Agent state under the active Nodex Profile", async () => {
    const previousNodexHome = process.env.NODEX_HOME;
    const nodexHome = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-agent-state-home-"));
    process.env.NODEX_HOME = nodexHome;

    try {
      const service = new CodexService();

      try {
        const expectedAgentHome = path.join(nodexHome, "agent");
        expect(Reflect.get(service, "runtimeStateHome")).toBe(expectedAgentHome);
        expect(localClientOf<{ expectedCodexHome: string }>(service).expectedCodexHome)
          .toBe(expectedAgentHome);
      } finally {
        await service.shutdown();
      }
    } finally {
      if (previousNodexHome === undefined) delete process.env.NODEX_HOME;
      else process.env.NODEX_HOME = previousNodexHome;
      fs.rmSync(nodexHome, { recursive: true, force: true });
    }
  });

  test("materializes Agent feature defaults before resolving the runtime environment", async () => {
    const runtimeStateHome = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-agent-defaults-"));
    fs.writeFileSync(
      path.join(runtimeStateHome, "config.toml"),
      "[features]\nprevent_idle_sleep = false\n",
    );
    const runtime: ResolvedCodexRuntime = {
      source: "bundled",
      binaryPath: "/tmp/nodex/codex",
      browserRuntime: {
        message: "Browser runtime is not installed",
        reason: "manifest-missing",
        status: "unavailable",
      },
      additionalSearchPaths: ["/tmp/nodex/path"],
      codexCompatibilityVersion: "0.146.0",
      metadataPath: "/tmp/nodex/agent-runtime.json",
      missingBinaryMessage: "Bundled agent runtime is missing or corrupted. Reinstall Nodex.",
      runtimeFamily: "open-interpreter",
      rootPath: "/tmp/nodex",
      version: "0.115.0",
    };
    const service = new CodexService({ runtime, runtimeStateHome });

    try {
      const client = localClientOf<{
        resolveEnv: () => Promise<NodeJS.ProcessEnv>;
      }>(service);
      const environment = await client.resolveEnv();
      const parsed = parseToml(fs.readFileSync(
        path.join(runtimeStateHome, "config.toml"),
        "utf8",
      ));

      expect(environment.INTERPRETER_HOME).toBe(runtimeStateHome);
      expect(parsed).toMatchObject({
        features: {
          unified_exec: true,
          shell_snapshot: true,
          multi_agent: true,
          prevent_idle_sleep: false,
          respect_system_proxy: true,
        },
      });
    } finally {
      await service.shutdown();
      fs.rmSync(runtimeStateHome, { recursive: true, force: true });
    }
  });
});
