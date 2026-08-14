import type { ScenarioDomainRecipe } from "./contracts";
import { boardDenseScenario } from "./scenarios/board-dense";

const scenarios = new Map<string, ScenarioDomainRecipe>([
  [boardDenseScenario.id, boardDenseScenario],
]);

export const listScenarioIds = (): readonly string[] => [...scenarios.keys()];

export const getScenario = (scenarioId: string): ScenarioDomainRecipe => {
  const scenario = scenarios.get(scenarioId);
  if (scenario) return scenario;
  throw new Error(
    `Unknown scenario ${scenarioId}. Available scenarios: ${listScenarioIds().join(", ")}`,
  );
};
