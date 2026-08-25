import path from "node:path";

import {
  isRecord,
  readWorkflow,
  requireRecord,
  workflowsDirectory,
  type UnknownRecord,
} from "./github-workflow-files";

const RELEASE_SOURCE_ENVIRONMENT = "release-source";
const RELEASE_SOURCE_GUARD_ACTION = "./.github/actions/verify-protected-main-source";
const RELEASE_SOURCE_WORKFLOWS = [
  "_assemble-release.yml",
  "_certify-release-source.yml",
  "nightly-release-recovery.yml",
  "release-recovery.yml",
  "release-rehearsal.yml",
] as const;

function environmentName(job: UnknownRecord): string | null {
  if (typeof job.environment === "string") return job.environment;
  if (!isRecord(job.environment)) return null;
  return typeof job.environment.name === "string" ? job.environment.name : null;
}

function neededJobNames(job: UnknownRecord): readonly string[] {
  if (typeof job.needs === "string") return [job.needs];
  if (!Array.isArray(job.needs)) return [];
  return job.needs.filter((name): name is string => typeof name === "string");
}

function jobSteps(job: UnknownRecord): readonly UnknownRecord[] {
  if (!Array.isArray(job.steps)) return [];
  return job.steps.filter(isRecord);
}

function containsSourceSha(value: unknown): boolean {
  return typeof value === "string" && value.includes("source_sha");
}

function isSourceCheckout(step: UnknownRecord): boolean {
  if (typeof step.uses !== "string" || !step.uses.startsWith("actions/checkout@")) return false;
  return isRecord(step.with) && containsSourceSha(step.with.ref);
}

function consumesSourceSha(job: UnknownRecord): boolean {
  if (
    typeof job.uses === "string" &&
    isRecord(job.with) &&
    containsSourceSha(job.with.source_sha)
  ) {
    return true;
  }
  return jobSteps(job).some(isSourceCheckout);
}

function hasProtectedSourcePrerequisite(
  jobName: string,
  jobs: Readonly<Record<string, unknown>>,
  visited = new Set<string>(),
): boolean {
  if (visited.has(jobName)) return false;
  visited.add(jobName);

  const job = requireRecord(jobs[jobName], `${jobName} job`);
  if (environmentName(job) === RELEASE_SOURCE_ENVIRONMENT) return true;
  return neededJobNames(job).some((needed) =>
    hasProtectedSourcePrerequisite(needed, jobs, new Set(visited)),
  );
}

export function verifyReleaseSourceWorkflow(label: string, workflow: UnknownRecord): void {
  const jobs = requireRecord(workflow.jobs, `${label}.jobs`);
  const guardedJobs = Object.entries(jobs).filter(([, rawJob]) => {
    const job = requireRecord(rawJob, `${label} job`);
    return (
      environmentName(job) === RELEASE_SOURCE_ENVIRONMENT &&
      jobSteps(job).some((step) => step.uses === RELEASE_SOURCE_GUARD_ACTION)
    );
  });
  if (guardedJobs.length === 0) {
    throw new Error(`${label} has no ${RELEASE_SOURCE_ENVIRONMENT} protected source guard`);
  }

  for (const [jobName, rawJob] of Object.entries(jobs)) {
    const job = requireRecord(rawJob, `${label}:${jobName} job`);
    const steps = jobSteps(job);
    const guardIndex = steps.findIndex((step) => step.uses === RELEASE_SOURCE_GUARD_ACTION);
    const sourceCheckoutIndex = steps.findIndex(isSourceCheckout);
    if (guardIndex >= 0 && sourceCheckoutIndex >= 0 && guardIndex > sourceCheckoutIndex) {
      throw new Error(
        `${label}:${jobName} verifies protected-main provenance after source checkout`,
      );
    }
    if (!consumesSourceSha(job)) continue;
    if (hasProtectedSourcePrerequisite(jobName, jobs)) continue;
    throw new Error(
      `${label}:${jobName} consumes source_sha without the ${RELEASE_SOURCE_ENVIRONMENT} guard`,
    );
  }
}

const main = (): void => {
  for (const filename of RELEASE_SOURCE_WORKFLOWS) {
    const filePath = path.join(workflowsDirectory, filename);
    verifyReleaseSourceWorkflow(filename, readWorkflow(filePath));
  }
  process.stdout.write(
    `Verified protected-main source execution across ${RELEASE_SOURCE_WORKFLOWS.length} release workflows.\n`,
  );
};

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
