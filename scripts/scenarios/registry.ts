import type { ScenarioDomainRecipe } from "./contracts";
import { boardDenseScenario } from "./scenarios/board-dense";
import { databaseContextMenuPerformanceScenario } from "./scenarios/database-context-menu-performance";
import { pageRelatedChatActivityScenario } from "./scenarios/page-related-chat-activity";

const scenarios = new Map<string, ScenarioDomainRecipe>([
  [boardDenseScenario.id, boardDenseScenario],
  [databaseContextMenuPerformanceScenario.id, databaseContextMenuPerformanceScenario],
  [pageRelatedChatActivityScenario.id, pageRelatedChatActivityScenario],
]);

export const listScenarioIds = (): readonly string[] => [...scenarios.keys()];

export const getScenario = (scenarioId: string): ScenarioDomainRecipe => {
  const scenario = scenarios.get(scenarioId);
  if (scenario) return scenario;
  throw new Error(
    `Unknown scenario ${scenarioId}. Available scenarios: ${listScenarioIds().join(", ")}`,
  );
};
