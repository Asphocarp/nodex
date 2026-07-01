import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createGhPrComment,
  readGhCliStatus,
  readGhPrComments,
  readGhPrStatus,
} from "./github-pr-service";

const tempDirs: string[] = [];
const originalPath = process.env.PATH;

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function installFakeGhEnvironment(cwd: string, scriptBody: string): string {
  const binDir = path.join(cwd, "bin");
  const logPath = path.join(cwd, "commands.log");
  mkdirSync(binDir, { recursive: true });
  writeFileSync(path.join(binDir, "git"), [
    "#!/usr/bin/env node",
    "const args = process.argv.slice(2);",
    "if (args[0] === 'remote' && args[1] === '-v') {",
    "  console.log('origin\\thttps://github.com/acme/project.git (fetch)');",
    "  process.exit(0);",
    "}",
    "process.exit(0);",
  ].join("\n"));
  writeFileSync(path.join(binDir, "gh"), [
    "#!/usr/bin/env node",
    "const fs = require('node:fs');",
    `const logPath = ${JSON.stringify(logPath)};`,
    "const args = process.argv.slice(2);",
    "fs.appendFileSync(logPath, args.join('\\u0000') + '\\n');",
    scriptBody,
  ].join("\n"));
  chmodSync(path.join(binDir, "git"), 0o755);
  chmodSync(path.join(binDir, "gh"), 0o755);
  process.env.PATH = `${binDir}${path.delimiter}${originalPath ?? ""}`;
  return logPath;
}

afterEach(() => {
  process.env.PATH = originalPath;
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (!dir) continue;
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("github PR service", () => {
  test("returns a typed disabled state when GitHub PR review is unavailable", async () => {
    const cwd = createTempDir("nodex-gh-pr-missing-");
    process.env.PATH = "";

    const status = await readGhCliStatus({ cwd });
    const prStatus = await readGhPrStatus({ cwd });

    expect(status.available).toBeFalse();
    expect(["missing-gh", "missing-remote", "not-authenticated"].includes(status.status)).toBeTrue();
    expect(prStatus.available).toBeFalse();
    expect(prStatus.status).toBe("disabled");
    expect(prStatus.disabledReason).toBe(status.status);
  });

  test("reads pull request review comments from the inline comments API", async () => {
    const cwd = createTempDir("nodex-gh-pr-comments-");
    installFakeGhEnvironment(cwd, [
      "if (args[0] === '--version') process.exit(0);",
      "if (args[0] === 'auth' && args[1] === 'status') process.exit(0);",
      "if (args[0] === 'api') {",
      "  console.log(JSON.stringify([{ id: 12, path: 'src/example.ts', line: 8, side: 'RIGHT', start_line: 6, start_side: 'RIGHT', body: 'Tighten this', user: { login: 'octo' }, html_url: 'https://github.test/c/12', in_reply_to_id: 9, outdated: false }]));",
      "  process.exit(0);",
      "}",
      "process.exit(1);",
    ].join("\n"));

    const result = await readGhPrComments({ cwd, prNumber: 7 });

    expect(result.available).toBeTrue();
    expect(result.comments.length).toBe(1);
    expect(result.comments[0]?.id).toBe("12");
    expect(result.comments[0]?.path).toBe("src/example.ts");
    expect(result.comments[0]?.line).toBe(8);
    expect(result.comments[0]?.side).toBe("RIGHT");
    expect(result.comments[0]?.startLine).toBe(6);
    expect(result.comments[0]?.startSide).toBe("RIGHT");
    expect(result.comments[0]?.replyToId).toBe("9");
    expect(result.comments[0]?.author).toBe("octo");
  });

  test("posts inline review comments through gh api with commit and range fields", async () => {
    const cwd = createTempDir("nodex-gh-pr-inline-");
    const logPath = installFakeGhEnvironment(cwd, [
      "if (args[0] === '--version') process.exit(0);",
      "if (args[0] === 'auth' && args[1] === 'status') process.exit(0);",
      "if (args[0] === 'pr' && args[1] === 'view') {",
      "  console.log(JSON.stringify({ headRefOid: 'abc123' }));",
      "  process.exit(0);",
      "}",
      "if (args[0] === 'api') {",
      "  console.log(JSON.stringify({ html_url: 'https://github.test/c/99' }));",
      "  process.exit(0);",
      "}",
      "process.exit(1);",
    ].join("\n"));

    const result = await createGhPrComment({
      type: "inline",
      cwd,
      prNumber: 42,
      body: "Please change this",
      path: "src/example.ts",
      line: 12,
      side: "RIGHT",
      startLine: 10,
      startSide: "RIGHT",
    });
    const log = readFileSync(logPath, "utf8");

    expect(result.available).toBeTrue();
    expect(result.url).toBe("https://github.test/c/99");
    expect(Boolean(log.includes("repos/{owner}/{repo}/pulls/42/comments"))).toBeTrue();
    expect(Boolean(log.includes("commit_id=abc123"))).toBeTrue();
    expect(Boolean(log.includes("path=src/example.ts"))).toBeTrue();
    expect(Boolean(log.includes("line=12"))).toBeTrue();
    expect(Boolean(log.includes("side=RIGHT"))).toBeTrue();
    expect(Boolean(log.includes("start_line=10"))).toBeTrue();
  });

  test("rejects empty pull request comment bodies before posting", async () => {
    const cwd = createTempDir("nodex-gh-pr-empty-");
    installFakeGhEnvironment(cwd, [
      "if (args[0] === '--version') process.exit(0);",
      "if (args[0] === 'auth' && args[1] === 'status') process.exit(0);",
      "process.exit(0);",
    ].join("\n"));

    const result = await createGhPrComment({
      cwd,
      prNumber: 1,
      body: "   ",
    });

    expect(result.available).toBeFalse();
    expect(result.disabledReason).toBe("error");
    expect(result.message).toBe("Pull request comment body is required.");
  });
});
