#!/usr/bin/env tsx

import { spawn } from "node:child_process";

import { getScenario } from "../registry";
import { parseUiLabCliArguments } from "./cli-arguments";
import { openUiLab } from "./ui-lab";

const runCommand = async (command: string, args: readonly string[]): Promise<void> => {
  const child = spawn(command, [...args], { stdio: "inherit", cwd: process.cwd() });
  const code = await new Promise<number>((resolve) => {
    child.once("exit", (exitCode) => resolve(exitCode ?? 1));
  });
  if (code !== 0) throw new Error(`${command} ${args.join(" ")} exited with ${code}`);
};

const main = async (): Promise<void> => {
  const arguments_ = parseUiLabCliArguments(process.argv.slice(2));
  if (arguments_.command === "verify") {
    getScenario(arguments_.scenarioId);
    await runCommand("pnpm", ["run", "core:binaries:build:dev"]);
    await runCommand("pnpm", ["run", "build"]);
    await runCommand("pnpm", [
      "exec",
      "playwright",
      "test",
      "--config",
      "playwright.e2e.config.ts",
      "tests/e2e/scenario-ui.spec.ts",
      "--grep",
      arguments_.scenarioId,
    ]);
    return;
  }
  if (arguments_.target.kind === "seed") {
    getScenario(arguments_.target.scenarioId);
    process.stdout.write(
      `Starting UI Lab from seed ${arguments_.target.scenarioId} (${arguments_.appMode})...\n`,
    );
  } else {
    process.stdout.write(
      `Resuming UI Lab session ${arguments_.target.sessionId} (${arguments_.appMode})...\n`,
    );
  }
  const session = await openUiLab({
    target: arguments_.target,
    appMode: arguments_.appMode,
  });
  process.stdout.write(
    `\nUI Lab ready\nSession: ${session.sessionId}\nSeed: ${session.seed.scenarioId}@${session.seed.scenarioRevision}\nRetained Profile: ${session.profile.runRoot}\n`,
  );
  let resolveInterruption: (() => void) | null = null;
  const interruption = new Promise<void>((resolve) => {
    resolveInterruption = resolve;
  });
  const stop = () => {
    resolveInterruption?.();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  const exitCode = await Promise.race([
    session.exit,
    interruption.then(async () => {
      await session.stop();
      return 0;
    }),
  ]);
  process.exitCode = exitCode;
};

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
