import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import {
  parseRunTimedArguments,
  runTimedCommand,
} from "./run-timed";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("CI timed command runner", () => {
  test("parses a command after the separator without consuming command flags", () => {
    expect(parseRunTimedArguments([
      "--name",
      "rust-tests",
      "--",
      "cargo",
      "test",
      "--workspace",
    ])).toEqual({
      name: "rust-tests",
      command: "cargo",
      commandArguments: ["test", "--workspace"],
    });
  });

  test("records successful and failed child commands with a step summary", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "nodex-ci-timed-"));
    temporaryRoots.push(root);
    const summaryPath = path.join(root, "summary.md");
    const success = await runTimedCommand({
      name: "successful step",
      command: process.execPath,
      commandArguments: ["-e", "process.exit(0)"],
      timingDirectory: root,
      summaryPath,
      env: { ...process.env, CI_TIMING_JOB: "test job" },
    });
    const failure = await runTimedCommand({
      name: "failed step",
      command: process.execPath,
      commandArguments: ["-e", "process.exit(7)"],
      timingDirectory: root,
      summaryPath,
      env: { ...process.env, CI_TIMING_JOB: "test job" },
    });
    expect(success.exitCode).toBe(0);
    expect(failure.exitCode).toBe(7);
    const records = (await readFile(path.join(root, "test-job.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { name: string; exitCode: number });
    expect(records.map(({ name, exitCode }) => ({ name, exitCode }))).toEqual([
      { name: "successful step", exitCode: 0 },
      { name: "failed step", exitCode: 7 },
    ]);
    const summary = await readFile(summaryPath, "utf8");
    expect(summary).toContain("| successful step |");
    expect(summary).toContain("| failed step |");
  });
});
