import { describe, expect, test } from "vitest";
import {
  aggregateTerminalProcessMetrics,
  collectDescendantPids,
  parseUnixProcessMetricOutput,
  parseUnixProcessTreeOutput,
  parseWindowsProcessMetricOutput,
} from "./terminal-process-metrics";

describe("terminal process metrics", () => {
  test("collects descendants while excluding the terminal root process", () => {
    const entries = parseUnixProcessTreeOutput(`
      100 1
      101 100
      102 101
      103 100
      200 1
    `);

    expect(collectDescendantPids(entries, [{ pid: 100, includeRoot: false }]).sort().join(",")).toBe("101,102,103");
    expect(collectDescendantPids(entries, [{ pid: 100, includeRoot: true }]).sort().join(",")).toBe("100,101,102,103");
  });

  test("parses and aggregates unix process metrics", () => {
    const samples = parseUnixProcessMetricOutput(`
      101 100 2.5 1024 01:02 /bin/zsh -l
      102 101 3.0 2048 1-02:03:04 bun run dev
    `);
    const metrics = aggregateTerminalProcessMetrics(samples, 123);

    expect(samples.length).toBe(2);
    expect(samples[0]?.ageSeconds).toBe(62);
    expect(samples[1]?.ageSeconds).toBe(93_784);
    expect(metrics.cpuPercent).toBe(5.5);
    expect(metrics.rssKb).toBe(3072n);
    expect(metrics.childProcessCount).toBe(2);
    expect(metrics.sampledAtMs).toBe(123);
  });

  test("parses windows process metrics JSON", () => {
    const samples = parseWindowsProcessMetricOutput(JSON.stringify([
      {
        ProcessId: 101,
        ParentProcessId: 100,
        CommandLine: "powershell.exe",
        WorkingSetSize: 2048 * 1024,
        CpuPercent: 7.25,
        AgeSeconds: 9.8,
      },
    ]));

    expect(samples.length).toBe(1);
    expect(samples[0]?.pid).toBe(101);
    expect(samples[0]?.parentPid).toBe(100);
    expect(samples[0]?.cpuPercent).toBe(7.25);
    expect(samples[0]?.rssKb).toBe(2048n);
    expect(samples[0]?.ageSeconds).toBe(9);
  });
});
