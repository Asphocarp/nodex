import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, test } from "vitest";

interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

interface ConfigField {
  value: unknown;
  source: string;
}

function runConfigShow(
  cwd: string,
  home: string,
  environmentHome?: string,
): Promise<CliResult> {
  const cliPath = path.join(process.cwd(), "bin", "nodex.mjs");
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: home,
  };
  delete env.NODEX_HOME;
  if (environmentHome !== undefined) {
    env.NODEX_HOME = environmentHome;
  }

  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [cliPath, "config", "show", "--json"],
      {
        cwd,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("close", (code) => {
      resolve({
        exitCode: code ?? 0,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      });
    });
  });
}

describe("Nodex home CLI config", () => {
  test("shows [server].home as the canonical config key", async () => {
    const fixtureRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "nodex-home-cli-"),
    );
    const home = path.join(fixtureRoot, "user");
    const workspace = path.join(fixtureRoot, "workspace");
    const configDirectory = path.join(home, ".nodex");
    fs.mkdirSync(configDirectory, { recursive: true });
    fs.mkdirSync(workspace, { recursive: true });
    fs.writeFileSync(
      path.join(configDirectory, "config.toml"),
      ["[server]", 'home = "~/profile-from-config"', ""].join("\n"),
      "utf8",
    );

    try {
      const result = await runConfigShow(workspace, home);

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      const config = JSON.parse(result.stdout) as Record<string, ConfigField>;
      expect(config["server.home"].value).toBe("~/profile-from-config");
      expect(config["server.home"].source).toBe(
        path.join(configDirectory, "config.toml"),
      );
    } finally {
      fs.rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  test("reports NODEX_HOME as the highest-priority source", async () => {
    const fixtureRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "nodex-home-cli-env-"),
    );
    const home = path.join(fixtureRoot, "user");
    const workspace = path.join(fixtureRoot, "workspace");
    const environmentHome = path.join(fixtureRoot, "environment-home");
    fs.mkdirSync(home, { recursive: true });
    fs.mkdirSync(workspace, { recursive: true });

    try {
      const result = await runConfigShow(
        workspace,
        home,
        environmentHome,
      );

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      const config = JSON.parse(result.stdout) as Record<string, ConfigField>;
      expect(config["server.home"]).toEqual({
        value: environmentHome,
        source: "env NODEX_HOME",
      });
    } finally {
      fs.rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });
});
