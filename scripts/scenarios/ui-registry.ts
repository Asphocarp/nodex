import type { Page } from "playwright";

import type { ScenarioFacts, ScenarioManifest } from "./contracts";
import {
  focusBoardDenseUi,
  observeBoardDenseUi,
} from "./scenarios/board-dense-ui";
import {
  BOARD_DENSE_SCENARIO_ID,
  requireBoardDenseScenarioFacts,
} from "./scenarios/board-dense";

export interface ScenarioUiProjection {
  focus(page: Page, manifest: ScenarioManifest): Promise<void>;
  verify(page: Page, facts: ScenarioFacts): Promise<void>;
}

const boardDenseUiProjection: ScenarioUiProjection = {
  focus: focusBoardDenseUi,
  verify: async (page, facts) => {
    const expected = requireBoardDenseScenarioFacts(facts);
    const observation = await observeBoardDenseUi(page);
    if (
      observation.totalCards !== expected.totalRows
      || observation.cardsByStatus.triage !== expected.groups.triage
      || observation.cardsByStatus.plan !== expected.groups.plan
      || observation.cardsByStatus.build !== expected.groups.build
      || observation.cardsByStatus.review !== expected.groups.review
      || observation.cardsByStatus.ship !== expected.groups.ship
      || !observation.pageStageVisible
      || !observation.editorVisible
    ) {
      throw new Error("board/dense UI projection does not match scenario facts");
    }
  },
};

const uiProjections = new Map<string, ScenarioUiProjection>([
  [BOARD_DENSE_SCENARIO_ID, boardDenseUiProjection],
]);

export const getScenarioUiProjection = (
  scenarioId: string,
): ScenarioUiProjection => {
  const projection = uiProjections.get(scenarioId);
  if (projection) return projection;
  throw new Error(`Scenario ${scenarioId} has no UI projection`);
};
