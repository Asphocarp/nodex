import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

interface GitHubWorkflowList {
  readonly workflows: readonly {
    readonly id: number;
    readonly name: string;
    readonly path: string;
  }[];
}

interface GitHubWorkflowRunList {
  readonly workflow_runs: readonly GitHubWorkflowRun[];
}

interface GitHubWorkflowRun {
  readonly conclusion: string | null;
  readonly created_at: string;
  readonly event: string;
  readonly head_branch: string | null;
  readonly head_sha: string;
  readonly html_url: string;
  readonly id: number;
  readonly run_attempt: number;
  readonly run_started_at?: string;
  readonly updated_at: string;
}

interface GitHubJobList {
  readonly jobs: readonly GitHubWorkflowJob[];
}

interface GitHubWorkflowJob {
  readonly completed_at: string | null;
  readonly conclusion: string | null;
  readonly name: string;
  readonly started_at: string | null;
  readonly status: string;
}

export interface ActionsJobRecord {
  readonly completedAt: string | null;
  readonly conclusion: string | null;
  readonly name: string;
  readonly startedAt: string | null;
  readonly status: string;
}

export interface ActionsRunRecord {
  readonly attempt: number;
  readonly branch: string | null;
  readonly conclusion: string | null;
  readonly createdAt: string;
  readonly event: string;
  readonly id: number;
  readonly jobs: readonly ActionsJobRecord[];
  readonly sha: string;
  readonly startedAt: string | null;
  readonly updatedAt: string;
  readonly url: string;
}

export interface RunTimingRecord {
  readonly attempt: number;
  readonly branch: string | null;
  readonly conclusion: string | null;
  readonly event: string;
  readonly id: number;
  readonly jobSeconds: number;
  readonly queueMs: number;
  readonly sha: string;
  readonly url: string;
  readonly wallMs: number;
}

interface DistributionSummary {
  readonly p50: number | null;
  readonly p90: number | null;
}

export interface WorkflowTimingSummary {
  readonly outcomes: Readonly<Record<string, number>>;
  readonly queueMs: DistributionSummary;
  readonly runnerMinutes: DistributionSummary;
  readonly sampleCount: number;
  readonly wallMs: DistributionSummary;
}

interface TimingReportOptions {
  readonly branch?: string;
  readonly event?: string;
}

interface CliArguments extends TimingReportOptions {
  readonly limit: number;
  readonly output: string;
  readonly repo?: string;
  readonly workflow: string;
}

const parseTimestamp = (value: string, label: string): number => {
  const parsed = Date.parse(value);
  if (Number.isFinite(parsed)) return parsed;
  throw new Error(`${label} is not an ISO timestamp: ${JSON.stringify(value)}.`);
};

const duration = (startedAt: string | null, completedAt: string | null): number => {
  if (!startedAt || !completedAt) return 0;
  return Math.max(0, parseTimestamp(completedAt, "completedAt") - parseTimestamp(startedAt, "startedAt"));
};

const nearestRank = (values: readonly number[], percentile: number): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(percentile * sorted.length) - 1);
  return sorted[index] ?? null;
};

const distribution = (values: readonly number[]): DistributionSummary => ({
  p50: nearestRank(values, 0.5),
  p90: nearestRank(values, 0.9),
});

const terminalJobCompletion = (run: ActionsRunRecord): number => {
  const terminalNames = new Set(["required", "main complete", "nightly complete", "performance complete"]);
  const terminal = run.jobs.find((job) => terminalNames.has(job.name) && job.completedAt);
  return terminal?.completedAt
    ? parseTimestamp(terminal.completedAt, `${terminal.name}.completedAt`)
    : parseTimestamp(run.updatedAt, "run.updatedAt");
};

export const timingRecordForRun = (run: ActionsRunRecord): RunTimingRecord => {
  const createdAt = parseTimestamp(run.createdAt, "run.createdAt");
  const firstStartedAt = run.jobs
    .flatMap((job) => job.startedAt ? [parseTimestamp(job.startedAt, `${job.name}.startedAt`)] : [])
    .sort((left, right) => left - right)[0]
    ?? (run.startedAt ? parseTimestamp(run.startedAt, "run.startedAt") : createdAt);
  const jobMs = run.jobs.reduce(
    (total, job) => total + duration(job.startedAt, job.completedAt),
    0,
  );
  return {
    attempt: run.attempt,
    branch: run.branch,
    conclusion: run.conclusion,
    event: run.event,
    id: run.id,
    jobSeconds: jobMs / 1_000,
    queueMs: Math.max(0, firstStartedAt - createdAt),
    sha: run.sha,
    url: run.url,
    wallMs: Math.max(0, terminalJobCompletion(run) - createdAt),
  };
};

export const summarizeWorkflowRuns = (
  inputRuns: readonly ActionsRunRecord[],
  options: TimingReportOptions = {},
): { readonly runs: readonly RunTimingRecord[]; readonly summary: WorkflowTimingSummary } => {
  const latestAttempts = new Map<number, ActionsRunRecord>();
  for (const run of inputRuns) {
    const current = latestAttempts.get(run.id);
    if (!current || run.attempt > current.attempt) latestAttempts.set(run.id, run);
  }
  const runs = [...latestAttempts.values()]
    .filter((run) => !options.branch || run.branch === options.branch)
    .filter((run) => !options.event || run.event === options.event)
    .sort((left, right) => parseTimestamp(right.createdAt, "run.createdAt") - parseTimestamp(left.createdAt, "run.createdAt"))
    .map(timingRecordForRun);
  const outcomes: Record<string, number> = {};
  for (const run of runs) {
    const outcome = run.conclusion ?? "in_progress";
    outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
  }
  const successfulFirstAttempts = runs.filter((run) => run.conclusion === "success" && run.attempt === 1);
  return {
    runs,
    summary: {
      outcomes,
      queueMs: distribution(successfulFirstAttempts.map((run) => run.queueMs)),
      runnerMinutes: distribution(successfulFirstAttempts.map((run) => run.jobSeconds / 60)),
      sampleCount: successfulFirstAttempts.length,
      wallMs: distribution(successfulFirstAttempts.map((run) => run.wallMs)),
    },
  };
};

const readOption = (args: readonly string[], name: string): string | undefined => {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`Missing value for ${name}.`);
  return value;
};

export const parseReportArguments = (args: readonly string[]): CliArguments => {
  const workflow = readOption(args, "--workflow");
  const output = readOption(args, "--output");
  const limitValue = readOption(args, "--limit");
  const limit = Number(limitValue);
  if (!workflow || !output || !Number.isSafeInteger(limit) || limit <= 0 || limit > 100) {
    throw new Error("Usage: report-actions-timings --workflow <name> --limit <1-100> --output <path> [--repo <owner/name>] [--event <event>] [--branch <branch>].");
  }
  return {
    branch: readOption(args, "--branch"),
    event: readOption(args, "--event"),
    limit,
    output,
    repo: readOption(args, "--repo"),
    workflow,
  };
};

const ghJson = <T>(args: readonly string[]): T => {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return JSON.parse(execFileSync(
        "gh",
        ["api", ...args],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      )) as T;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
};

const resolveRepository = (explicit: string | undefined): string => {
  if (explicit) return explicit;
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;
  const value = execFileSync(
    "gh",
    ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).trim();
  if (value) return value;
  throw new Error("Could not resolve a GitHub repository; pass --repo owner/name.");
};

const resolveWorkflowId = (repository: string, workflow: string): number => {
  const response = ghJson<GitHubWorkflowList>([
    `repos/${repository}/actions/workflows`,
    "--paginate",
    "--slurp",
  ]);
  const workflows = Array.isArray(response)
    ? (response as unknown as readonly GitHubWorkflowList[]).flatMap((page) => page.workflows)
    : response.workflows;
  const matches = workflows.filter((candidate) => (
    candidate.name === workflow
    || candidate.path === workflow
    || String(candidate.id) === workflow
  ));
  if (matches.length === 1) return matches[0]?.id ?? 0;
  if (matches.length === 0) throw new Error(`Workflow ${JSON.stringify(workflow)} was not found.`);
  throw new Error(`Workflow ${JSON.stringify(workflow)} is ambiguous.`);
};

const fetchRuns = (repository: string, workflowId: number, limit: number): readonly ActionsRunRecord[] => {
  const response = ghJson<GitHubWorkflowRunList>([
    "--method",
    "GET",
    `repos/${repository}/actions/workflows/${workflowId}/runs`,
    "-f",
    `per_page=${limit}`,
  ]);
  return response.workflow_runs.slice(0, limit).map((run) => {
    const jobs = ghJson<GitHubJobList>([
      "--method",
      "GET",
      `repos/${repository}/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs`,
      "-f",
      "per_page=100",
    ]).jobs;
    return {
      attempt: run.run_attempt,
      branch: run.head_branch,
      conclusion: run.conclusion,
      createdAt: run.created_at,
      event: run.event,
      id: run.id,
      jobs: jobs.map((job) => ({
        completedAt: job.completed_at,
        conclusion: job.conclusion,
        name: job.name,
        startedAt: job.started_at,
        status: job.status,
      })),
      sha: run.head_sha,
      startedAt: run.run_started_at ?? null,
      updatedAt: run.updated_at,
      url: run.html_url,
    };
  });
};

const displayDuration = (value: number | null, unit: "minutes" | "milliseconds"): string => {
  if (value === null) return "n/a";
  const minutes = unit === "milliseconds" ? value / 60_000 : value;
  return `${minutes.toFixed(2)}m`;
};

export const formatTimingSummary = (workflow: string, summary: WorkflowTimingSummary): string => [
  `# ${workflow} timing summary`,
  "",
  `Successful first-attempt samples: ${summary.sampleCount}`,
  `Wall p50 / p90: ${displayDuration(summary.wallMs.p50, "milliseconds")} / ${displayDuration(summary.wallMs.p90, "milliseconds")}`,
  `Queue p50 / p90: ${displayDuration(summary.queueMs.p50, "milliseconds")} / ${displayDuration(summary.queueMs.p90, "milliseconds")}`,
  `Runner-minutes p50 / p90: ${displayDuration(summary.runnerMinutes.p50, "minutes")} / ${displayDuration(summary.runnerMinutes.p90, "minutes")}`,
  `Outcomes: ${Object.entries(summary.outcomes).sort().map(([name, count]) => `${name}=${count}`).join(", ") || "none"}`,
  "",
].join("\n");

const main = (): void => {
  const options = parseReportArguments(process.argv.slice(2));
  const repository = resolveRepository(options.repo);
  const workflowId = resolveWorkflowId(repository, options.workflow);
  const report = summarizeWorkflowRuns(
    fetchRuns(repository, workflowId, options.limit),
    { branch: options.branch, event: options.event },
  );
  const output = path.resolve(options.output);
  mkdirSync(path.dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify({ repository, workflow: options.workflow, ...report }, null, 2)}\n`, "utf8");
  process.stdout.write(formatTimingSummary(options.workflow, report.summary));
};

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
