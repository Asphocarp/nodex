import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, test } from "vitest";
import { parse as parseToml, TomlDate } from "smol-toml";

const createdSandboxes: string[] = [];

const createSandbox = (): {
  readonly fakeBin: string;
  readonly invocationLog: string;
  readonly remoteDebuggingPortLog: string;
  readonly runRoot: string;
  readonly sandbox: string;
  readonly sourceCodexHome: string;
} => {
  const sandbox = mkdtempSync(path.join(tmpdir(), "nodex-run-script-test-"));
  const fakeBin = path.join(sandbox, "bin");
  const invocationLog = path.join(sandbox, "pnpm-argv.json");
  const remoteDebuggingPortLog = path.join(sandbox, "remote-debugging-port");
  const runRoot = path.join(sandbox, "run-root");
  const sourceCodexHome = path.join(sandbox, "source-codex-home");
  mkdirSync(fakeBin);
  mkdirSync(sourceCodexHome);
  const fakePnpm = path.join(fakeBin, "pnpm");
  const fakeNode = path.join(fakeBin, "node");
  const fakeExecutable = `#!${process.execPath}
const fs = require("node:fs");
const path = require("node:path");
const childProcess = require("node:child_process");
const args = process.argv.slice(2);
if (args.some((argument) => argument.endsWith("/scripts/copy-isolated-codex-config.ts"))) {
  const result = childProcess.spawnSync(process.execPath, args, { stdio: "inherit" });
  process.exit(result.status ?? 1);
}
fs.writeFileSync(process.env.FAKE_PNPM_LOG, JSON.stringify({
  command: path.basename(process.argv[1]),
  args,
}));
if (process.env.FAKE_REMOTE_DEBUGGING_PORT_LOG) {
  fs.writeFileSync(
    process.env.FAKE_REMOTE_DEBUGGING_PORT_LOG,
    process.env.NODEX_REMOTE_DEBUGGING_PORT ?? "<unset>",
  );
}
if (process.env.FAKE_PNPM_MODE === "leave-lease") {
  fs.mkdirSync(
    path.join(process.env.NODEX_HOME, "run/isolated-supervisor.lock"),
    { recursive: true, mode: 0o700 },
  );
}
process.exit(process.env.FAKE_PNPM_EXIT_CODE
  ? Number(process.env.FAKE_PNPM_EXIT_CODE)
  : 0);
`;
  writeFileSync(fakePnpm, fakeExecutable, { mode: 0o700 });
  writeFileSync(fakeNode, fakeExecutable, { mode: 0o700 });
  chmodSync(fakePnpm, 0o700);
  chmodSync(fakeNode, 0o700);
  createdSandboxes.push(sandbox);
  return {
    fakeBin,
    invocationLog,
    remoteDebuggingPortLog,
    runRoot,
    sandbox,
    sourceCodexHome,
  };
};

const runIsolatedScript = (
  input: ReturnType<typeof createSandbox>,
  options: {
    readonly args?: readonly string[];
    readonly mode?: string;
    readonly exitCode?: number;
    readonly remoteDebuggingPort?: string;
  } = {},
) => {
  const environment = {
    ...process.env,
    FAKE_PNPM_EXIT_CODE: options.exitCode?.toString(),
    FAKE_PNPM_LOG: input.invocationLog,
    FAKE_PNPM_MODE: options.mode,
    FAKE_REMOTE_DEBUGGING_PORT_LOG: input.remoteDebuggingPortLog,
    CODEX_HOME: input.sourceCodexHome,
    PATH: `${input.fakeBin}:${process.env.PATH ?? ""}`,
  };
  delete environment.NODEX_REMOTE_DEBUGGING_PORT;
  if (options.remoteDebuggingPort !== undefined) {
    environment.NODEX_REMOTE_DEBUGGING_PORT = options.remoteDebuggingPort;
  }

  return spawnSync(
    "bash",
    [
      "scripts/run.sh",
      "--root",
      input.runRoot,
      ...(options.args ?? []),
    ],
    {
      cwd: path.resolve("."),
      encoding: "utf8",
      env: environment,
    },
  );
};

afterEach(() => {
  for (const sandbox of createdSandboxes.splice(0)) {
    rmSync(sandbox, { force: true, recursive: true });
  }
});

describe("isolated run shell integration", () => {
  test("routes an isolated Nodex home through the supervisor and removes a safe root", () => {
    const sandbox = createSandbox();
    const result = runIsolatedScript(sandbox);

    expect(result.status).toBe(0);
    expect(JSON.parse(readFileSync(sandbox.invocationLog, "utf8"))).toEqual({
      command: "node",
      args: [
        "--import",
        "tsx",
        "scripts/isolated-run-supervisor.ts",
        "--",
        "build:run",
      ],
    });
    expect(existsSync(sandbox.runRoot)).toBe(false);
  });

  test("requests an OS-assigned DevTools port by default", () => {
    const sandbox = createSandbox();
    const result = runIsolatedScript(sandbox);

    expect(result.status).toBe(0);
    expect(readFileSync(sandbox.remoteDebuggingPortLog, "utf8")).toBe("0");
  });

  test("preserves an explicitly requested DevTools port", () => {
    const sandbox = createSandbox();
    const result = runIsolatedScript(sandbox, {
      remoteDebuggingPort: "9444",
    });

    expect(result.status).toBe(0);
    expect(readFileSync(sandbox.remoteDebuggingPortLog, "utf8")).toBe("9444");
  });

  test("preserves the root when supervisor ownership evidence remains", () => {
    const sandbox = createSandbox();
    const result = runIsolatedScript(sandbox, {
      mode: "leave-lease",
      exitCode: 1,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "isolated Core shutdown could not be confirmed",
    );
    expect(result.stderr).toContain(
      "Preserved isolated run directory for safety",
    );
    expect(existsSync(sandbox.runRoot)).toBe(true);
  });

  test("keeps global Nodex runs on the direct package-script path", () => {
    const sandbox = createSandbox();
    const result = runIsolatedScript(sandbox, {
      args: ["--global-nodex"],
    });

    expect(result.status).toBe(0);
    expect(JSON.parse(readFileSync(sandbox.invocationLog, "utf8"))).toEqual({
      command: "pnpm",
      args: ["--silent", "run", "build:run"],
    });
    expect(existsSync(sandbox.runRoot)).toBe(false);
  });

  test("copies an explicitly selected auth JSON into the isolated Codex home", () => {
    const sandbox = createSandbox();
    const authSource = path.join(sandbox.sandbox, "custom auth.json");
    writeFileSync(authSource, '{"tokens":{"access_token":"test-token"}}\n');

    const result = runIsolatedScript(sandbox, {
      args: ["--auth-json", authSource, "--keep"],
    });

    expect(result.status).toBe(0);
    const copiedAuth = path.join(
      sandbox.runRoot,
      ".nodex",
      "agent",
      "auth.json",
    );
    expect(readFileSync(copiedAuth, "utf8")).toBe(
      '{"tokens":{"access_token":"test-token"}}\n',
    );
    expect(statSync(copiedAuth).mode & 0o777).toBe(0o600);
  });

  test("rejects conflicting auth sources", () => {
    const sandbox = createSandbox();
    const authSource = path.join(sandbox.sandbox, "auth.json");
    writeFileSync(authSource, "{}\n");

    const duplicateSource = runIsolatedScript(sandbox, {
      args: ["--auth", `--auth-json=${authSource}`],
    });
    const globalCodex = runIsolatedScript(sandbox, {
      args: ["--global-codex", `--auth-json=${authSource}`],
    });

    expect(duplicateSource.status).toBe(1);
    expect(duplicateSource.stderr).toContain(
      "--auth cannot be combined with --auth-json",
    );
    expect(globalCodex.status).toBe(1);
    expect(globalCodex.stderr).toContain(
      "--global-codex cannot be combined with --auth, --auth-json, or --config",
    );
  });

  test("copies portable config without host-owned Browser runtime settings", () => {
    const sandbox = createSandbox();
    writeFileSync(path.join(sandbox.sourceCodexHome, "config.toml"), [
      "model = \"gpt-test\"",
      "integer_setting = 1",
      "float_setting = 1.0",
      "local_date_setting = 1979-05-27",
      "",
      "[features]",
      "unified_exec = false",
      "custom_feature = false",
      "",
      "[mcp_servers.node_repl]",
      "command = \"/Applications/ChatGPT.app/node_repl\"",
      "",
      "[mcp_servers.docs]",
      "command = \"docs-server\"",
      "",
      "[shell_environment_policy.set]",
      "BROWSER_USE_AVAILABLE_BACKENDS = \"chrome\"",
      "NODE_REPL_TRUSTED_BROWSER_CLIENT_SHA256S = \"foreign-hash\"",
      "NODE_REPL_TRUSTED_CODE_PATHS = \"/foreign/codex/home\"",
      "USER_SETTING = \"preserved\"",
      "",
    ].join("\n"));

    const result = runIsolatedScript(sandbox, { args: ["--config", "--keep"] });

    expect(result.status).toBe(0);
    const copied = parseToml(readFileSync(
      path.join(sandbox.runRoot, ".nodex", "agent", "config.toml"),
      "utf8",
    ), { integersAsBigInt: true });
    expect(copied).toMatchObject({
      model: "gpt-test",
      integer_setting: 1n,
      float_setting: 1,
      mcp_servers: {
        docs: { command: "docs-server" },
      },
      shell_environment_policy: {
        set: { USER_SETTING: "preserved" },
      },
      features: {
        unified_exec: false,
        shell_snapshot: true,
        multi_agent: true,
        prevent_idle_sleep: true,
        respect_system_proxy: true,
        custom_feature: false,
      },
    });
    expect(typeof copied.float_setting).toBe("number");
    expect(copied.local_date_setting).toBeInstanceOf(TomlDate);
    expect((copied.local_date_setting as TomlDate).isDate()).toBe(true);
    expect((copied.local_date_setting as TomlDate).isLocal()).toBe(true);
  });
});
