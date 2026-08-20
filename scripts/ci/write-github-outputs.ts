import { appendFileSync, readFileSync } from "node:fs";
import path from "node:path";

import { parseCiGatePlan, type CiGatePlan } from "./ci-gate-plan.ts";

interface ClassificationDocument {
  readonly changedPaths: readonly string[];
  readonly plan: CiGatePlan;
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const parseClassificationDocument = (value: unknown): ClassificationDocument => {
  if (!isRecord(value)) throw new Error("Classification document must be an object.");
  const unknown = Object.keys(value).filter((key) => key !== "changedPaths" && key !== "plan");
  if (unknown.length > 0) throw new Error(`Classification document has unknown fields: ${unknown.join(", ")}.`);
  if (!Array.isArray(value.changedPaths) || !value.changedPaths.every((entry) => typeof entry === "string")) {
    throw new Error("Classification changedPaths must be a string array.");
  }
  return {
    changedPaths: value.changedPaths,
    plan: parseCiGatePlan(value.plan),
  };
};

export const githubOutputForClassification = (document: ClassificationDocument): string => {
  const serialized = JSON.stringify(document.plan);
  if (serialized.includes("\n") || serialized.includes("\r")) {
    throw new Error("Serialized CI gate plan must fit on one GitHub output line.");
  }
  return `plan=${serialized}\n`;
};

const readOption = (args: readonly string[], name: string): string | undefined => {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`Missing value for ${name}.`);
  return value;
};

const main = (): void => {
  const input = readOption(process.argv.slice(2), "--input");
  const output = process.env.GITHUB_OUTPUT;
  if (!input || !output) throw new Error("--input and GITHUB_OUTPUT are required.");
  const document = parseClassificationDocument(JSON.parse(readFileSync(input, "utf8")));
  appendFileSync(output, githubOutputForClassification(document), "utf8");
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (!summary) return;
  appendFileSync(
    summary,
    `## Change classification\n\n${document.changedPaths.length} changed path(s).\n\n    ${JSON.stringify(document.plan)}\n`,
    "utf8",
  );
};

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
