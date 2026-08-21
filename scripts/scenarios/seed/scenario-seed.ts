import type { ScenarioFacts, ScenarioManifest, ScenarioSeedPort } from "../contracts";
import { getScenario } from "../registry";

export const materializeScenario = async (
  scenarioId: string,
  port: ScenarioSeedPort,
  workspace: string,
): Promise<ScenarioManifest> => await getScenario(scenarioId).materialize(port, workspace);

export const inspectScenario = async (
  manifest: ScenarioManifest,
  port: ScenarioSeedPort,
): Promise<ScenarioFacts> => {
  const scenario = getScenario(manifest.scenarioId);
  if (scenario.revision !== manifest.scenarioRevision) {
    throw new Error(
      `Scenario revision mismatch for ${manifest.scenarioId}: expected ${scenario.revision}, received ${manifest.scenarioRevision}`,
    );
  }
  return await scenario.inspect(port, manifest);
};
