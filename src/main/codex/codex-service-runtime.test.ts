import { describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CodexService } from "./codex-service";
import type { ResolvedCodexRuntime } from "./codex-runtime";

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
      codexCompatibilityVersion: "0.144.5",
      metadataPath: "/tmp/nodex/agent-runtime.json",
      missingBinaryMessage: "Bundled agent runtime is missing or corrupted. Reinstall Nodex.",
      runtimeFamily: "open-interpreter",
      rootPath: "/tmp/nodex",
      version: "0.115.0",
    };
    const service = new CodexService({ runtime }) as unknown as {
      client: {
        additionalSearchPaths: string[];
        binaryPath: string;
        missingBinaryMessage: string;
      };
      shutdown: () => Promise<void>;
    };

    try {
      expect(service.client.binaryPath).toBe(runtime.binaryPath);
      expect(service.client.additionalSearchPaths[0]).toBe(runtime.additionalSearchPaths[0]);
      expect(service.client.missingBinaryMessage).toBe(runtime.missingBinaryMessage);
    } finally {
      await service.shutdown();
    }
  });

  test("defers default runtime validation until the app-server client starts", async () => {
    const previousCwd = process.cwd();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-codex-service-runtime-"));

    process.chdir(tempDir);

    try {
      const service = new CodexService() as unknown as {
        client: {
          additionalSearchPaths: string[];
          binaryPath: string;
          missingBinaryMessage: string;
        };
        shutdown: () => Promise<void>;
      };

      try {
        const expectedRuntimeRootSuffix = path.join(".generated", "codex-runtime", "agent-runtime");
        expect(service.client.binaryPath.endsWith(
          path.join(expectedRuntimeRootSuffix, "bin", "interpreter"),
        )).toBe(true);
        expect((service.client.additionalSearchPaths[0] ?? "").endsWith(
          path.join(expectedRuntimeRootSuffix, "codex-path"),
        )).toBe(true);
        expect(service.client.missingBinaryMessage).toBe(
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
      const service = new CodexService() as unknown as {
        client: {
          expectedCodexHome: string;
        };
        runtimeStateHome: string;
        shutdown: () => Promise<void>;
      };

      try {
        const expectedAgentHome = path.join(nodexHome, "agent");
        expect(service.runtimeStateHome).toBe(expectedAgentHome);
        expect(service.client.expectedCodexHome).toBe(expectedAgentHome);
      } finally {
        await service.shutdown();
      }
    } finally {
      if (previousNodexHome === undefined) delete process.env.NODEX_HOME;
      else process.env.NODEX_HOME = previousNodexHome;
      fs.rmSync(nodexHome, { recursive: true, force: true });
    }
  });
});
