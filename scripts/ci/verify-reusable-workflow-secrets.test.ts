import path from "node:path";

import { expect, test } from "vitest";

import { verifyDeclaredReferences } from "./verify-reusable-workflow-secrets";

const workflow = (jobs: Record<string, unknown>): Record<string, unknown> => ({
  jobs,
  on: {
    workflow_call: {
      secrets: {
        DECLARED_SECRET: { required: true },
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
  }))).toThrow("assemble references undeclared");
});
