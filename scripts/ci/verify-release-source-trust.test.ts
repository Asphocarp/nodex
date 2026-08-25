import { describe, expect, test } from "vite-plus/test";

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
