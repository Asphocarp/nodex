import { describe, expect, test } from "vite-plus/test";

import {
  fetchRuns,
  parseReportArguments,
  summarizeWorkflowRuns,
  timingRecordForRun,
  type ActionsRunRecord,
} from "./report-actions-timings";

const run = ({
  attempt = 1,
  conclusion = "success",
  createdAt = "2026-08-20T00:00:00.000Z",
  id,
  startedAt = "2026-08-20T00:00:10.000Z",
  terminalAt,
}: {
  readonly attempt?: number;
  readonly conclusion?: string;
  readonly createdAt?: string;
  readonly id: number;
  readonly startedAt?: string;
  readonly terminalAt: string;
}): ActionsRunRecord => ({
  attempt,
  branch: "main",
  conclusion,
  createdAt,
  event: "push",
  id,
  jobs: [
    {
      completedAt: terminalAt,
      conclusion,
      name: "work",
      startedAt,
      status: "completed",
    },
    {
      completedAt: terminalAt,
      conclusion,
      name: "main complete",
      startedAt: terminalAt,
      status: "completed",
    },
  ],
  sha: `sha-${id}`,
  startedAt,
  updatedAt: terminalAt,
  url: `https://example.test/runs/${id}`,
});

describe("GitHub Actions timing reports", () => {
  test("calculates nearest-rank percentiles, queue time, and runner minutes", () => {
    const report = summarizeWorkflowRuns([
      run({ id: 1, terminalAt: "2026-08-20T00:01:00.000Z" }),
      run({ id: 2, terminalAt: "2026-08-20T00:02:00.000Z" }),
      run({ id: 3, terminalAt: "2026-08-20T00:03:00.000Z" }),
      run({ id: 4, terminalAt: "2026-08-20T00:04:00.000Z" }),
      run({ id: 5, terminalAt: "2026-08-20T00:10:00.000Z" }),
    ]);
    expect(report.summary).toMatchObject({
      outcomes: { success: 5 },
      queueMs: { p50: 10_000, p90: 10_000 },
      sampleCount: 5,
      wallMs: { p50: 180_000, p90: 600_000 },
    });
    expect(report.summary.runnerMinutes.p50).toBeCloseTo(2.8333, 3);
  });

  test("counts failures but excludes failures and reruns from latency samples", () => {
    const report = summarizeWorkflowRuns([
      run({ conclusion: "failure", id: 10, terminalAt: "2026-08-20T00:01:00.000Z" }),
      run({ attempt: 1, id: 11, terminalAt: "2026-08-20T00:08:00.000Z" }),
      run({ attempt: 2, id: 11, terminalAt: "2026-08-20T00:02:00.000Z" }),
    ]);
    expect(report.summary).toMatchObject({
      outcomes: { failure: 1, success: 1 },
      sampleCount: 0,
      wallMs: { p50: null, p90: null },
    });
    expect(report.runs.find((candidate) => candidate.id === 11)?.attempt).toBe(2);
  });

  test("filters event and branch before summarizing", () => {
    const report = summarizeWorkflowRuns(
      [
        run({ id: 20, terminalAt: "2026-08-20T00:01:00.000Z" }),
        { ...run({ id: 21, terminalAt: "2026-08-20T00:02:00.000Z" }), branch: "feature" },
      ],
      { branch: "main", event: "push" },
    );
    expect(report.runs.map(({ id }) => id)).toEqual([20]);
  });

  test("filters runs at the API and flattens every paginated job page", () => {
    const calls: string[][] = [];
    const request = <T>(args: readonly string[]): T => {
      calls.push([...args]);
      if (args[2]?.includes("/actions/workflows/")) {
        return {
          workflow_runs: [
            {
              conclusion: "success",
              created_at: "2026-08-20T00:00:00.000Z",
              event: "push",
              head_branch: "main",
              head_sha: "sha-30",
              html_url: "https://example.test/runs/30",
              id: 30,
              run_attempt: 2,
              run_started_at: "2026-08-20T00:00:05.000Z",
              updated_at: "2026-08-20T00:03:00.000Z",
            },
          ],
        } as T;
      }
      const ordinaryJobs = Array.from({ length: 100 }, (_, index) => ({
        completed_at: "2026-08-20T00:01:00.000Z",
        conclusion: "success",
        name: `job-${index}`,
        started_at: "2026-08-20T00:00:10.000Z",
        status: "completed",
      }));
      return [
        { jobs: ordinaryJobs },
        {
          jobs: [
            {
              completed_at: "2026-08-20T00:02:00.000Z",
              conclusion: "success",
              name: "required",
              started_at: "2026-08-20T00:01:59.000Z",
              status: "completed",
            },
          ],
        },
      ] as T;
    };

    const [fetched] = fetchRuns("owner/repo", 7, 20, { branch: "main", event: "push" }, request);
    expect(calls[0]).toEqual([
      "--method",
      "GET",
      "repos/owner/repo/actions/workflows/7/runs",
      "-f",
      "branch=main",
      "-f",
      "event=push",
      "-f",
      "per_page=20",
    ]);
    expect(calls[1]).toEqual([
      "--method",
      "GET",
      "repos/owner/repo/actions/runs/30/attempts/2/jobs",
      "-f",
      "per_page=100",
      "--paginate",
      "--slurp",
    ]);
    expect(fetched?.jobs).toHaveLength(101);
    expect(fetched && timingRecordForRun(fetched).wallMs).toBe(120_000);
  });

  test("requires an explicit workflow, sample limit, and output", () => {
    expect(
      parseReportArguments(["--workflow", "CI", "--limit", "20", "--output", "report.json"]),
    ).toMatchObject({ limit: 20, output: "report.json", workflow: "CI" });
    expect(() => parseReportArguments(["--workflow", "CI"])).toThrow("Usage:");
  });
});
