import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { load } from "js-yaml";
import { describe, expect, test } from "vite-plus/test";

import { isRecord, repositoryRoot, requireRecord } from "./github-workflow-files";
import { verifyReleaseSourceWorkflow } from "./verify-release-source-trust";

const guardJob = {
  environment: "release-source",
  steps: [
    { uses: "actions/checkout@pinned", with: { ref: "main" } },
    {
      uses: "./.github/actions/verify-protected-main-source",
      with: { source_sha: "${{ inputs.source_sha }}" },
    },
  ],
};

describe("release source workflow trust", () => {
  test("queries runs from the canonical Main CI workflow", () => {
    const actionPath = path.join(
      repositoryRoot,
      ".github/actions/verify-protected-main-source/action.yml",
    );
    const action = requireRecord(load(readFileSync(actionPath, "utf8")), "protected source action");
    const runs = requireRecord(action.runs, "protected source action runs");
    const steps = Array.isArray(runs.steps) ? runs.steps.filter(isRecord) : [];
    const run = steps[0]?.run;
    expect(typeof run).toBe("string");

    const temporaryDirectory = mkdtempSync(path.join(tmpdir(), "nodex-protected-source-"));
    const requestLog = path.join(temporaryDirectory, "requests.jsonl");
    const fakeGh = path.join(temporaryDirectory, "gh");
    writeFileSync(
      fakeGh,
      `#!/usr/bin/env node
const { appendFileSync } = require("node:fs");
const args = process.argv.slice(2);
appendFileSync(process.env.GH_API_REQUEST_LOG, JSON.stringify(args) + "\\n");
const endpoint = args.find((argument) => argument.startsWith("repos/"));
if (endpoint?.includes("/compare/")) {
  process.stdout.write("ahead\\n");
  process.exit(0);
}
if (endpoint === "repos/example/nodex/actions/workflows/ci-main.yml/runs") {
  process.stdout.write("1\\n");
  process.exit(0);
}
process.stderr.write("Unexpected GitHub API endpoint: " + endpoint + "\\n");
process.exit(64);
`,
      { mode: 0o755 },
    );

    try {
      const sourceSha = "a".repeat(40);
      const result = spawnSync("bash", ["-c", run as string], {
        encoding: "utf8",
        env: {
          ...process.env,
          GH_API_REQUEST_LOG: requestLog,
          GH_TOKEN: "test-token",
          GITHUB_REPOSITORY: "example/nodex",
          PATH: `${temporaryDirectory}:${process.env.PATH ?? ""}`,
          SOURCE_SHA: sourceSha,
        },
      });
      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);

      const requests = readFileSync(requestLog, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as string[]);
      expect(requests).toHaveLength(2);
      expect(requests[1]).toContain("repos/example/nodex/actions/workflows/ci-main.yml/runs");
      expect(requests[1]).toContain(`head_sha=${sourceSha}`);
      expect(requests[1]).toContain("event=push");
      expect(requests[1]).toContain("status=completed");
    } finally {
      rmSync(temporaryDirectory, { force: true, recursive: true });
    }
  });

  test("accepts source consumers dominated by the protected source guard", () => {
    expect(() =>
      verifyReleaseSourceWorkflow("release.yml", {
        jobs: {
          guard: guardJob,
          consume: {
            needs: "guard",
            steps: [
              {
                uses: "actions/checkout@pinned",
                with: { ref: "${{ inputs.source_sha }}" },
              },
            ],
          },
        },
      }),
    ).not.toThrow();
  });

  test("rejects an unguarded reusable source consumer", () => {
    expect(() =>
      verifyReleaseSourceWorkflow("release.yml", {
        jobs: {
          guard: guardJob,
          consume: {
            uses: "./.github/workflows/build.yml",
            with: { source_sha: "${{ inputs.source_sha }}" },
          },
        },
      }),
    ).toThrow("consumes source_sha without the release-source guard");
  });

  test("does not treat an unrelated environment job as a protected source guard", () => {
    expect(() =>
      verifyReleaseSourceWorkflow("release.yml", {
        jobs: {
          guard: guardJob,
          approval: {
            environment: "release-source",
            steps: [{ run: "echo approved" }],
          },
          consume: {
            needs: "approval",
            steps: [
              {
                uses: "actions/checkout@pinned",
                with: { ref: "${{ inputs.source_sha }}" },
              },
            ],
          },
        },
      }),
    ).toThrow("consumes source_sha without the release-source guard");
  });

  test("rejects provenance validation after an untrusted checkout", () => {
    expect(() =>
      verifyReleaseSourceWorkflow("release.yml", {
        jobs: {
          validate: {
            environment: "release-source",
            steps: [
              {
                uses: "actions/checkout@pinned",
                with: { ref: "${{ inputs.source_sha }}" },
              },
              {
                uses: "./.github/actions/verify-protected-main-source",
                with: { source_sha: "${{ inputs.source_sha }}" },
              },
            ],
          },
        },
      }),
    ).toThrow("verifies protected-main provenance after source checkout");
  });
});
