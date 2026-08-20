import { describe, expect, test } from "vitest";

import {
  parseReportArguments,
  summarizeWorkflowRuns,
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
    const report = summarizeWorkflowRuns([
      run({ id: 20, terminalAt: "2026-08-20T00:01:00.000Z" }),
      { ...run({ id: 21, terminalAt: "2026-08-20T00:02:00.000Z" }), branch: "feature" },
    ], { branch: "main", event: "push" });
    expect(report.runs.map(({ id }) => id)).toEqual([20]);
  });

  test("requires an explicit workflow, sample limit, and output", () => {
    expect(parseReportArguments([
      "--workflow", "CI", "--limit", "20", "--output", "report.json",
    ])).toMatchObject({ limit: 20, output: "report.json", workflow: "CI" });
    expect(() => parseReportArguments(["--workflow", "CI"])).toThrow("Usage:");
  });
});
