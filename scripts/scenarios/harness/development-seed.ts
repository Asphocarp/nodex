import { existsSync } from "node:fs";
import path from "node:path";

import {
  initializeStandaloneDataAuthority,
  type RustDataAuthorityRuntime,
} from "../../../src/main/core-client";
import { CoreClientSeedAdapter } from "../adapters/core-client-seed-adapter";
import type { ScenarioManifest } from "../contracts";
import { materializeScenario } from "../seed/scenario-seed";

const waitForCoreRemoval = async (nodexHome: string): Promise<void> => {
  const socketPath = path.join(nodexHome, "run/core/core.sock");
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (!existsSync(socketPath)) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Core socket remained after seed shutdown: ${socketPath}`);
};

export const materializeDevelopmentSeed = async (input: {
  readonly environment?: NodeJS.ProcessEnv;
  readonly scenarioId: string;
  readonly nodexHome: string;
  readonly workspace: string;
}): Promise<ScenarioManifest> => {
  let runtime: RustDataAuthorityRuntime | null = null;
  let manifest: ScenarioManifest | null = null;
  let operationError: unknown;
  try {
    runtime = await initializeStandaloneDataAuthority({
      buildId: `dev-seed:${input.scenarioId}`,
      environment: input.environment,
      isPackaged: false,
      nodexHome: input.nodexHome,
    });
    manifest = await materializeScenario(
      input.scenarioId,
      new CoreClientSeedAdapter(runtime),
      input.workspace,
    );
  } catch (error) {
    operationError = error;
  }

  const teardownErrors: unknown[] = [];
  if (runtime) {
    try {
      await runtime.rootClient.shutdown();
      await waitForCoreRemoval(input.nodexHome);
    } catch (error) {
      teardownErrors.push(error);
    }
  }
  if (operationError && teardownErrors.length > 0) {
    throw new AggregateError(
      [operationError, ...teardownErrors],
      `Seed ${input.scenarioId} and Core teardown both failed`,
    );
  }
  if (operationError) throw operationError;
  if (teardownErrors.length > 0) {
    throw new AggregateError(teardownErrors, `Seed ${input.scenarioId} Core teardown failed`);
  }
  if (!manifest) throw new Error(`Seed ${input.scenarioId} produced no manifest`);
  return manifest;
};
