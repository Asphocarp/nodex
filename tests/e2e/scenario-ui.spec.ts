import { expect, test } from "@playwright/test";

import { withElectronScenario } from "../../scripts/scenarios/harness/electron-e2e-harness";
import {
  focusBoardDenseProjectHome,
  focusBoardDenseUi,
  observeBoardDenseUi,
} from "../../scripts/scenarios/scenarios/board-dense-ui";
import { BOARD_DENSE_SCENARIO_ID } from "../../scripts/scenarios/scenarios/board-dense";

test("materializes and opens the authoritative board/dense UI scenario", async ({}, testInfo) => {
  test.setTimeout(120_000);
  await withElectronScenario({
    label: "board-dense-ui",
    scenarioId: BOARD_DENSE_SCENARIO_ID,
    onFailure: async ({ facts, manifest, page, readRuntimeLogs }) => {
      await testInfo.attach("scenario-state-at-failure", {
        body: Buffer.from(`${JSON.stringify({ facts, manifest }, null, 2)}\n`),
        contentType: "application/json",
      });
      await testInfo.attach("runtime-logs-at-failure", {
        body: Buffer.from(await readRuntimeLogs()),
        contentType: "text/plain",
      });
      const screenshot = await page?.screenshot({ fullPage: true }).catch(() => null);
      if (screenshot) {
        await testInfo.attach("scenario-failure", {
          body: screenshot,
          contentType: "image/png",
        });
      }
    },
  }, async ({ application, page, manifest, facts, readRuntimeLogs }) => {
    if (!manifest || !facts) throw new Error("board/dense did not materialize");
    await testInfo.attach("scenario-facts", {
      body: Buffer.from(`${JSON.stringify(facts, null, 2)}\n`),
      contentType: "application/json",
    });
    await application.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      window?.setBounds({ x: 0, y: 0, width: 1440, height: 960 });
    });
    await page.emulateMedia({ colorScheme: "light" });
    await expect.poll(() => page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
    }))).toEqual({ width: 1440, height: 960 });
    await focusBoardDenseProjectHome(page, manifest);
    const boardScreenshot = testInfo.outputPath("board-project-home.png");
    await page.screenshot({ path: boardScreenshot, fullPage: true });
    await focusBoardDenseUi(page, manifest);
    const observation = await observeBoardDenseUi(page);
    expect(observation).toEqual({
      totalCards: 10,
      cardsByStatus: { triage: 3, plan: 2, build: 3, review: 1, ship: 1 },
      pageStageVisible: true,
      editorVisible: true,
    });
    const pageStage = page.locator('[data-page-stage-surface="true"]:visible');
    await expect(pageStage.getByRole("heading", { name: "Rendering contract" }))
      .toBeVisible();
    await expect(pageStage.getByText("Use the authoritative Database projection"))
      .toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);

    const pageScreenshot = testInfo.outputPath("page-stage-open.png");
    await page.screenshot({ path: pageScreenshot, fullPage: true });
    await testInfo.attach("page-stage-open", {
      path: pageScreenshot,
      contentType: "image/png",
    });
    await testInfo.attach("board-project-home", {
      path: boardScreenshot,
      contentType: "image/png",
    });
    await testInfo.attach("runtime-logs", {
      body: Buffer.from(await readRuntimeLogs()),
      contentType: "text/plain",
    });
  });
});
