import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { load } from "js-yaml";

type UnknownRecord = Readonly<Record<string, unknown>>;

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const workflowsDirectory = path.join(repositoryRoot, ".github/workflows");
const secretReferencePattern = /secrets\.([A-Za-z_][A-Za-z0-9_]*)/gu;
const environmentSecretContracts = new Map<string, ReadonlySet<string>>([
  ["sparkle-feed-finalization", new Set(["SPARKLE_ED25519_PRIVATE_KEY"])],
]);
const environmentSecretNames = new Set(
  [...environmentSecretContracts.values()].flatMap((names) => [...names]),
);

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const requireRecord = (value: unknown, label: string): UnknownRecord => {
  if (isRecord(value)) return value;
  throw new Error(`${label} must be an object`);
};

const workflowFiles = (): readonly string[] => readdirSync(workflowsDirectory)
  .filter((entry) => entry.endsWith(".yml") || entry.endsWith(".yaml"))
  .sort()
  .map((entry) => path.join(workflowsDirectory, entry));

const readWorkflow = (filePath: string): UnknownRecord => requireRecord(
  load(readFileSync(filePath, "utf8")),
  path.relative(repositoryRoot, filePath),
);

const workflowCallSecrets = (workflow: UnknownRecord): UnknownRecord => {
  const triggers = workflow.on;
  if (!isRecord(triggers)) return {};
  const workflowCall = triggers.workflow_call;
  if (!isRecord(workflowCall)) return {};
  return isRecord(workflowCall.secrets) ? workflowCall.secrets : {};
};

const referencedSecrets = (value: unknown): ReadonlySet<string> => {
  const references = new Set<string>();
  const visit = (candidate: unknown): void => {
    if (typeof candidate === "string") {
      for (const match of candidate.matchAll(secretReferencePattern)) {
        const name = match[1];
        if (name) references.add(name);
      }
      return;
    }
    if (Array.isArray(candidate)) {
      for (const entry of candidate) visit(entry);
      return;
    }
    if (!isRecord(candidate)) return;
    for (const entry of Object.values(candidate)) visit(entry);
  };
  visit(value);
  return references;
};

const resolveLocalWorkflow = (callerPath: string, uses: string): string => {
  const target = path.resolve(repositoryRoot, uses.slice(2));
  const relative = path.relative(workflowsDirectory, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${path.relative(repositoryRoot, callerPath)} calls a workflow outside .github/workflows`);
  }
  return target;
};

export const verifyDeclaredReferences = (filePath: string, workflow: UnknownRecord): void => {
  const declared = workflowCallSecrets(workflow);
  if (Object.keys(declared).length === 0) return;
  const jobs = requireRecord(workflow.jobs, `${path.relative(repositoryRoot, filePath)}.jobs`);
  const workflowWithoutJobs = { ...workflow };
  delete workflowWithoutJobs.jobs;
  const topLevelReferences = [...referencedSecrets(workflowWithoutJobs)];
  const topLevelEnvironmentSecrets = topLevelReferences
    .filter((name) => environmentSecretNames.has(name))
    .sort();
  if (topLevelEnvironmentSecrets.length > 0) {
    throw new Error(
      `${path.relative(repositoryRoot, filePath)} references protected environment secrets outside a job: ${topLevelEnvironmentSecrets.join(", ")}`,
    );
  }
  const topLevelUndeclared = topLevelReferences
    .filter((name) => !Object.hasOwn(declared, name))
    .sort();
  if (topLevelUndeclared.length > 0) {
    throw new Error(
      `${path.relative(repositoryRoot, filePath)} references undeclared workflow-call secrets outside a job: ${topLevelUndeclared.join(", ")}`,
    );
  }
  for (const [jobName, rawJob] of Object.entries(jobs)) {
    const job = requireRecord(rawJob, `${jobName} job`);
    const allowed = typeof job.environment === "string"
      ? environmentSecretContracts.get(job.environment) ?? new Set<string>()
      : new Set<string>();
    const references = [...referencedSecrets(job)];
    const misplacedEnvironmentSecrets = references
      .filter((name) => environmentSecretNames.has(name) && !allowed.has(name))
      .sort();
    if (misplacedEnvironmentSecrets.length > 0) {
      throw new Error(
        `${path.relative(repositoryRoot, filePath)}:${jobName} references protected environment secrets outside their environment: ${misplacedEnvironmentSecrets.join(", ")}`,
      );
    }
    const undeclared = references
      .filter((name) => !Object.hasOwn(declared, name) && !allowed.has(name))
      .sort();
    if (undeclared.length > 0) {
      throw new Error(
        `${path.relative(repositoryRoot, filePath)}:${jobName} references undeclared workflow-call secrets: ${undeclared.join(", ")}`,
      );
    }
  }
};

export const verifyCall = (
  callerPath: string,
  jobName: string,
  job: UnknownRecord,
  workflows: ReadonlyMap<string, UnknownRecord>,
): void => {
  const uses = job.uses;
  if (typeof uses !== "string" || !uses.startsWith("./.github/workflows/")) return;
  const targetPath = resolveLocalWorkflow(callerPath, uses);
  const target = workflows.get(targetPath);
  if (!target) throw new Error(`${uses} does not resolve to a repository workflow`);

  if (job.secrets === "inherit") {
    throw new Error(`${path.relative(repositoryRoot, callerPath)}:${jobName} must map secrets explicitly`);
  }
  const provided = job.secrets === undefined
    ? {}
    : requireRecord(job.secrets, `${path.relative(repositoryRoot, callerPath)}:${jobName}.secrets`);
  const transportedEnvironmentSecrets = Object.keys(provided)
    .filter((name) => environmentSecretNames.has(name))
    .sort();
  if (transportedEnvironmentSecrets.length > 0) {
    throw new Error(
      `${path.relative(repositoryRoot, callerPath)}:${jobName} must resolve protected environment secrets in the called job: ${transportedEnvironmentSecrets.join(", ")}`,
    );
  }
  const declared = workflowCallSecrets(target);
  const unknown = Object.keys(provided).filter((name) => !Object.hasOwn(declared, name)).sort();
  if (unknown.length > 0) {
    throw new Error(`${path.relative(repositoryRoot, callerPath)}:${jobName} passes undeclared secrets: ${unknown.join(", ")}`);
  }

  const missing = Object.entries(declared)
    .filter(([, definition]) => isRecord(definition) && definition.required === true)
    .map(([name]) => name)
    .filter((name) => !Object.hasOwn(provided, name))
    .sort();
  if (missing.length === 0) return;
  throw new Error(`${path.relative(repositoryRoot, callerPath)}:${jobName} omits required secrets: ${missing.join(", ")}`);
};

const main = (): void => {
  const workflows = new Map(workflowFiles().map((filePath) => [filePath, readWorkflow(filePath)]));
  for (const [filePath, workflow] of workflows) {
    verifyDeclaredReferences(filePath, workflow);
    const jobs = requireRecord(workflow.jobs, `${path.relative(repositoryRoot, filePath)}.jobs`);
    for (const [jobName, job] of Object.entries(jobs)) {
      verifyCall(filePath, jobName, requireRecord(job, `${jobName} job`), workflows);
    }
  }
  process.stdout.write(`Verified reusable-workflow secret contracts across ${workflows.size} workflows.\n`);
};

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main();
}
