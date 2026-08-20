import path from "node:path";

import { APP_TEST_SUITES, parseCiGatePlan, STATIC_GROUPS } from "./ci-gate-plan";
import {
  readWorkflow,
  repositoryRoot,
  requireRecord,
  workflowFiles,
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
  workflowName: string,
): readonly string[] => {
  const jobs = requireRecord(workflow.jobs, `${workflowName} jobs`);
  const job = requireRecord(jobs[jobName], `${workflowName} ${jobName} job`);
  const inputs = requireRecord(job.with, `${workflowName} ${jobName} inputs`);
  return parseStringArray(inputs[inputName], `${workflowName} ${jobName}.${inputName}`);
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

const requireFullGatePlan = (workflow: UnknownRecord, workflowName: string): void => {
  const jobs = requireRecord(workflow.jobs, `${workflowName} jobs`);
  const job = requireRecord(jobs["app-tests"], `${workflowName} app-tests job`);
  const inputs = requireRecord(job.with, `${workflowName} app-tests inputs`);
  if (typeof inputs.gate_plan_json !== "string") {
    throw new Error(`${workflowName} app-tests.gate_plan_json must be a JSON string.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(inputs.gate_plan_json) as unknown;
  } catch (cause) {
    throw new Error(
      `${workflowName} app-tests.gate_plan_json must contain valid JSON.`,
      { cause },
    );
  }
  const plan = parseCiGatePlan(parsed);
  if (plan.testMode !== "full" || !plan.rustFull) {
    throw new Error(`${workflowName} must use a full deterministic gate plan.`);
  }
};

export const verifyFullCiContracts = (
  workflow: UnknownRecord,
  workflowName = "Nightly CI",
): void => {
  requireExactEntries(
    requireReusableInput(workflow, "static-contracts", "groups_json", workflowName),
    STATIC_GROUPS,
    `${workflowName} static groups`,
  );
  requireExactEntries(
    requireReusableInput(workflow, "app-tests", "suites_json", workflowName),
    APP_TEST_SUITES,
    `${workflowName} app test suites`,
  );
  requireFullGatePlan(workflow, workflowName);
};

export const verifyAppTestMatrixContracts = (workflow: UnknownRecord): void => {
  const jobs = requireRecord(workflow.jobs, "Application test workflow jobs");
  const testJob = requireRecord(jobs.test, "Application test matrix job");
  const environment = testJob.env === undefined
    ? {}
    : requireRecord(testJob.env, "Application test matrix job environment");
  const unsafeGlobalVariables = ["RUSTC_WRAPPER", "SCCACHE_GHA_ENABLED"]
    .filter((name) => Object.hasOwn(environment, name));
  if (unsafeGlobalVariables.length > 0) {
    throw new Error(
      `Application test matrix must scope Rust cache variables to Rust-bearing steps: ${unsafeGlobalVariables.join(", ")}.`,
    );
  }
  if (!Array.isArray(testJob.steps)) return;
  const duplicatedBuildResources = testJob.steps.some((candidate) => {
    if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) return false;
    const run = (candidate as UnknownRecord).run;
    return typeof run === "string" && /\bbuild-resources:prepare\b/u.test(run);
  });
  if (duplicatedBuildResources) {
    throw new Error(
      "Application test cells must not regenerate build resources owned by the generated static contract.",
    );
  }
};

const referencedNeeds = (value: unknown): ReadonlySet<string> => {
  const references = new Set<string>();
  const visit = (candidate: unknown): void => {
    if (typeof candidate === "string") {
      for (const match of candidate.matchAll(/\bneeds\.([A-Za-z_][A-Za-z0-9_-]*)\b/gu)) {
        const name = match[1];
        if (name) references.add(name);
      }
      return;
    }
    if (Array.isArray(candidate)) {
      for (const entry of candidate) visit(entry);
      return;
    }
    if (typeof candidate !== "object" || candidate === null) return;
    for (const entry of Object.values(candidate)) visit(entry);
  };
  visit(value);
  return references;
};

const declaredNeeds = (value: unknown, label: string): ReadonlySet<string> => {
  if (value === undefined) return new Set();
  if (typeof value === "string") return new Set([value]);
  if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) {
    return new Set(value);
  }
  throw new Error(`${label} needs must be a job id or array of job ids.`);
};

export const verifyDirectNeedsContracts = (
  workflow: UnknownRecord,
  workflowName: string,
): void => {
  const jobs = requireRecord(workflow.jobs, `${workflowName} jobs`);
  for (const [jobName, rawJob] of Object.entries(jobs)) {
    const job = requireRecord(rawJob, `${workflowName} ${jobName} job`);
    const available = declaredNeeds(job.needs, `${workflowName} ${jobName}`);
    const missing = [...referencedNeeds(job)].filter((name) => !available.has(name)).sort();
    if (missing.length > 0) {
      throw new Error(
        `${workflowName} ${jobName} references undeclared direct needs: ${missing.join(", ")}.`,
      );
    }
  }
};

const main = (): void => {
  verifyFullCiContracts(readWorkflow(path.join(
    repositoryRoot,
    ".github/workflows/ci-nightly.yml",
  )));
  verifyFullCiContracts(readWorkflow(path.join(
    repositoryRoot,
    ".github/workflows/_certify-release-source.yml",
  )), "Release certification");
  verifyAppTestMatrixContracts(readWorkflow(path.join(
    repositoryRoot,
    ".github/workflows/_app-tests.yml",
  )));
  for (const workflowPath of workflowFiles()) {
    verifyDirectNeedsContracts(readWorkflow(workflowPath), path.relative(repositoryRoot, workflowPath));
  }
  process.stdout.write("Verified CI matrix coverage and prerequisite isolation.\n");
};

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main();
}
