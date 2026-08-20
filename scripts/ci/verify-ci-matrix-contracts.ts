import path from "node:path";

import { APP_TEST_SUITES, STATIC_GROUPS } from "./ci-gate-plan";
import {
  readWorkflow,
  repositoryRoot,
  requireRecord,
  type UnknownRecord,
} from "./github-workflow-files";

const parseStringArray = (value: unknown, label: string): readonly string[] => {
  if (typeof value !== "string") throw new Error(`${label} must be a JSON string.`);
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || !parsed.every((entry): entry is string => typeof entry === "string")) {
    throw new Error(`${label} must contain a JSON string array.`);
  }
  return parsed;
};

const requireReusableInput = (
  workflow: UnknownRecord,
  jobName: string,
  inputName: string,
): readonly string[] => {
  const jobs = requireRecord(workflow.jobs, "Main CI jobs");
  const job = requireRecord(jobs[jobName], `Main CI ${jobName} job`);
  const inputs = requireRecord(job.with, `Main CI ${jobName} inputs`);
  return parseStringArray(inputs[inputName], `Main CI ${jobName}.${inputName}`);
};

const requireExactEntries = (
  actual: readonly string[],
  expected: readonly string[],
  label: string,
): void => {
  if (actual.length === expected.length && actual.every((entry, index) => entry === expected[index])) {
    return;
  }
  throw new Error(
    `${label} must exactly match its canonical entries: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}.`,
  );
};

export const verifyMainCiContracts = (workflow: UnknownRecord): void => {
  requireExactEntries(
    requireReusableInput(workflow, "static-contracts", "groups_json"),
    STATIC_GROUPS,
    "Main CI static groups",
  );
  requireExactEntries(
    requireReusableInput(workflow, "app-tests", "suites_json"),
    APP_TEST_SUITES,
    "Main CI app test suites",
  );
};

export const verifyAppTestMatrixContracts = (workflow: UnknownRecord): void => {
  const jobs = requireRecord(workflow.jobs, "Application test workflow jobs");
  const testJob = requireRecord(jobs.test, "Application test matrix job");
  const environment = testJob.env === undefined
    ? {}
    : requireRecord(testJob.env, "Application test matrix job environment");
  const unsafeGlobalVariables = ["RUSTC_WRAPPER", "SCCACHE_GHA_ENABLED"]
    .filter((name) => Object.hasOwn(environment, name));
  if (unsafeGlobalVariables.length === 0) return;
  throw new Error(
    `Application test matrix must scope Rust cache variables to Rust-bearing steps: ${unsafeGlobalVariables.join(", ")}.`,
  );
};

const main = (): void => {
  verifyMainCiContracts(readWorkflow(path.join(
    repositoryRoot,
    ".github/workflows/ci-main.yml",
  )));
  verifyAppTestMatrixContracts(readWorkflow(path.join(
    repositoryRoot,
    ".github/workflows/_app-tests.yml",
  )));
  process.stdout.write("Verified CI matrix coverage and prerequisite isolation.\n");
};

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main();
}
