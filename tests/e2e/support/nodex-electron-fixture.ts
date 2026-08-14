import { test as base } from "@playwright/test";

import {
  ElectronScenarioHarness,
  type ElectronHarnessInput,
} from "../../../scripts/scenarios/harness/electron-e2e-harness";

interface NodexElectronFixtures {
  readonly createNodexElectron: (
    input: Omit<ElectronHarnessInput, "label"> & { readonly label?: string },
  ) => Promise<ElectronScenarioHarness>;
}

export const test = base.extend<NodexElectronFixtures>({
  createNodexElectron: async ({}, use, testInfo) => {
    const harnesses: ElectronScenarioHarness[] = [];
    await use(async (input) => {
      const harness = await ElectronScenarioHarness.create({
        ...input,
        label: input.label ?? testInfo.title,
      });
      harnesses.push(harness);
      return harness;
    });
    const teardownErrors: unknown[] = [];
    for (const harness of harnesses.reverse()) {
      try {
        await harness.close();
      } catch (error) {
        teardownErrors.push(error);
      }
    }
    if (teardownErrors.length > 0) {
      throw new AggregateError(teardownErrors, "Nodex Electron fixture teardown failed");
    }
  },
});

export { expect } from "@playwright/test";
