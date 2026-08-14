import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { executeSemanticThemeCommand } from "./module";
import type { SemanticThemeCommand } from "./types";

const readOption = (args: readonly string[], name: string): string | undefined => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

const buildCommand = (args: readonly string[]): SemanticThemeCommand => {
  const kind = args[0];
  const sourcePath = readOption(args, "--source") ?? process.env.REFERENCE_THEME_SOURCE;
  const refVersion = readOption(args, "--ref-version");

  if (kind === "verify-build") {
    return { kind, buildCssPath: readOption(args, "--build-css") };
  }
  if (kind === "verify") {
    return { kind, ...(sourcePath ? { sourcePath } : {}) };
  }
  if ((kind === "audit" || kind === "sync") && sourcePath && refVersion) {
    return { kind, sourcePath, refVersion };
  }
  throw new Error("THEME_USAGE_INVALID");
};

const printUsage = (): void => {
  console.error(
    "Usage: semantic-theme audit --source <css> --ref-version <version> [--report <json>] | semantic-theme sync --source <css> --ref-version <version> | semantic-theme verify [--source <css>] | semantic-theme verify-build [--build-css <css>]",
  );
};

const run = async (): Promise<void> => {
  try {
    const args = process.argv.slice(2);
    const result = await executeSemanticThemeCommand(buildCommand(args));
    for (const item of result.diagnostics) {
      const line = `${item.code}: ${item.message}${item.subject ? ` (${item.subject})` : ""}`;
      if (item.severity === "error") console.error(line);
      else console.log(line);
    }
    if (result.changedArtifacts.length > 0) {
      console.log(`Changed artifacts: ${result.changedArtifacts.length}`);
      for (const artifact of result.changedArtifacts) console.log(`- ${artifact}`);
    }
    const reportPath = readOption(args, "--report");
    if (reportPath && result.auditReport) {
      const absoluteReportPath = resolve(reportPath);
      await mkdir(dirname(absoluteReportPath), { recursive: true });
      await writeFile(absoluteReportPath, `${JSON.stringify(result.auditReport, null, 2)}\n`, "utf8");
    }
    process.exitCode = result.ok ? 0 : 1;
  } catch (error) {
    if (error instanceof Error && error.message === "THEME_USAGE_INVALID") printUsage();
    else console.error("THEME_COMMAND_FAILED: The semantic theme command could not complete.");
    process.exitCode = 1;
  }
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void run();
}

export { buildCommand, run };
