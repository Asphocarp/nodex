import path from "node:path";

import {
  readWorkflow,
  relativeRepositoryPath,
  requireRecord,
  workflowFiles,
} from "./github-workflow-files";
import type { UnknownRecord } from "./github-workflow-files";

const sharedStressAction = "./.github/actions/run-stress-tests";
const requiredStressJobsByWorkflow: Readonly<Record<string, readonly string[]>> = {
  ".github/workflows/ci-nightly.yml": ["stress"],
};
const stressWordPattern = /(?:^|[-_\s])stress(?:$|[-_\s])/iu;
const directStressCommandPattern = /\bpnpm(?:\s+--silent)?\s+run\s+test:stress\b/u;
const duplicatedSetupCommandPattern = /\b(?:pnpm\s+install|build-resources:prepare|sccache\s+--show-stats)\b/u;
const duplicatedSetupActions = [
  "pnpm/action-setup@",
  "actions/setup-node@",
  "./.github/actions/setup-rust-ci",
  "./.github/actions/setup-playwright",
] as const;

const isStressJob = (jobName: string, job: UnknownRecord): boolean => {
  const displayName = typeof job.name === "string" ? job.name : "";
  return stressWordPattern.test(jobName) || stressWordPattern.test(displayName);
};

const stepLabel = (filePath: string, jobName: string): string =>
  `${relativeRepositoryPath(filePath)}:${jobName}`;

export const verifyRequiredStressWorkflowFiles = (
  workflowPaths: ReadonlySet<string>,
): void => {
  for (const requiredPath of Object.keys(requiredStressJobsByWorkflow)) {
    if (!workflowPaths.has(requiredPath)) {
      throw new Error(`Required stress workflow is missing: ${requiredPath}`);
    }
  }
};

export const verifyStressWorkflow = (
  filePath: string,
  workflow: UnknownRecord,
  requiredJobNames: readonly string[] = [],
): number => {
  const relativePath = relativeRepositoryPath(filePath);
  const jobs = requireRecord(workflow.jobs, `${relativePath}.jobs`);
  let stressJobCount = 0;

  for (const jobName of requiredJobNames) {
    if (!Object.hasOwn(jobs, jobName)) {
      throw new Error(`${relativePath} must define stress job ${jobName}`);
    }
  }

  for (const [jobName, rawJob] of Object.entries(jobs)) {
    const job = requireRecord(rawJob, `${stepLabel(filePath, jobName)} job`);
    if (!isStressJob(jobName, job)) continue;
    stressJobCount += 1;

    if (!Array.isArray(job.steps)) {
      throw new Error(`${stepLabel(filePath, jobName)} must provide stress steps`);
    }
    const steps = job.steps.map((step, index) =>
      requireRecord(step, `${stepLabel(filePath, jobName)}.steps[${index}]`));
    const sharedActionUses = steps.filter((step) => step.uses === sharedStressAction);
    if (sharedActionUses.length !== 1) {
      throw new Error(
        `${stepLabel(filePath, jobName)} must use ${sharedStressAction} exactly once`,
      );
    }

    for (const step of steps) {
      const uses = typeof step.uses === "string" ? step.uses : "";
      if (duplicatedSetupActions.some((action) => uses.startsWith(action))) {
        throw new Error(
          `${stepLabel(filePath, jobName)} duplicates setup owned by ${sharedStressAction}: ${uses}`,
        );
      }
      const run = typeof step.run === "string" ? step.run : "";
      if (directStressCommandPattern.test(run) || duplicatedSetupCommandPattern.test(run)) {
        throw new Error(
          `${stepLabel(filePath, jobName)} duplicates commands owned by ${sharedStressAction}`,
        );
      }
    }
  }

  return stressJobCount;
};

export const verifyStressWorkflowContracts = (): number => {
  const files = workflowFiles();
  verifyRequiredStressWorkflowFiles(new Set(files.map(relativeRepositoryPath)));

  let stressJobCount = 0;
  for (const filePath of files) {
    const relativePath = relativeRepositoryPath(filePath);
    stressJobCount += verifyStressWorkflow(
      filePath,
      readWorkflow(filePath),
      requiredStressJobsByWorkflow[relativePath],
    );
  }
  if (stressJobCount === 0) throw new Error("No stress workflow jobs were found");
  return stressJobCount;
};

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const count = verifyStressWorkflowContracts();
  process.stdout.write(`Verified shared stress-test ownership across ${count} workflow jobs.\n`);
}
