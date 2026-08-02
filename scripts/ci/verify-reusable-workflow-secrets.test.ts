import path from "node:path";

import { expect, test } from "vitest";

import { verifyCall, verifyDeclaredReferences } from "./verify-reusable-workflow-secrets";

const workflow = (jobs: Record<string, unknown>): Record<string, unknown> => ({
  jobs,
  on: {
    workflow_call: {
      secrets: {
        DECLARED_SECRET: { required: true },
        SPARKLE_ED25519_PRIVATE_KEY: { required: false },
      },
    },
  },
});

test("allows the Sparkle signing key only in its protected environment job", () => {
  const filePath = path.resolve(".github/workflows/test.yml");
  expect(() => verifyDeclaredReferences(filePath, workflow({
    finalize: {
      environment: "sparkle-feed-finalization",
      steps: [{ env: { KEY: "${{ secrets.SPARKLE_ED25519_PRIVATE_KEY }}" } }],
    },
    publish: {
      steps: [{ env: { TOKEN: "${{ secrets.DECLARED_SECRET }}" } }],
    },
  }))).not.toThrow();

  expect(() => verifyDeclaredReferences(filePath, workflow({
    finalize: {
      environment: "sparkle-feed-finalization",
      steps: [{ env: { KEY: "${{ secrets.SPARKLE_ED25519_PRIVATE_KEY }}" } }],
    },
    assemble: {
      steps: [{ env: { KEY: "${{ secrets.SPARKLE_ED25519_PRIVATE_KEY }}" } }],
    },
  }))).toThrow("assemble references protected environment secrets outside their environment");
});

test("rejects transporting a protected environment secret from a caller", () => {
  const callerPath = path.resolve(".github/workflows/caller.yml");
  const calledPath = path.resolve(".github/workflows/called.yml");
  const calledWorkflow = workflow({
    finalize: {
      environment: "sparkle-feed-finalization",
      steps: [{ env: { KEY: "${{ secrets.SPARKLE_ED25519_PRIVATE_KEY }}" } }],
    },
  });

  expect(() => verifyCall(callerPath, "distribution", {
    uses: "./.github/workflows/called.yml",
    secrets: {
      SPARKLE_ED25519_PRIVATE_KEY: "${{ secrets.SPARKLE_ED25519_PRIVATE_KEY }}",
    },
  }, new Map([[calledPath, calledWorkflow]]))).toThrow("must resolve protected environment secrets in the called job");
});
