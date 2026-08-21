import { describe, expect, test } from "vite-plus/test";

import { withCoreScenario } from "../../../scripts/scenarios/harness/core-scenario-harness";
import {
  DATABASE_CONTEXT_MENU_PERFORMANCE_PAGE_COUNT,
  DATABASE_CONTEXT_MENU_PERFORMANCE_PROPERTY_COUNT,
  DATABASE_CONTEXT_MENU_PERFORMANCE_SCENARIO_ID,
  requireDatabaseContextMenuPerformanceFacts,
} from "../../../scripts/scenarios/scenarios/database-context-menu-performance";

describe("Database context menu performance scenario over CoreClient", () => {
  test("materializes its complete authoritative Page and Property shape", async () => {
    await withCoreScenario(
      {
        scenarioId: DATABASE_CONTEXT_MENU_PERFORMANCE_SCENARIO_ID,
      },
      async ({ facts }) => {
        expect(requireDatabaseContextMenuPerformanceFacts(facts)).toMatchObject({
          totalRows: DATABASE_CONTEXT_MENU_PERFORMANCE_PAGE_COUNT,
          propertyCount: DATABASE_CONTEXT_MENU_PERFORMANCE_PROPERTY_COUNT,
        });
      },
    );
  });
});
