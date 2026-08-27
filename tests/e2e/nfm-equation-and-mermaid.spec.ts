import { expect, test, type Locator, type Page } from "@playwright/test";
import type { ElectronApplication } from "playwright";
import type { ScenarioManifest } from "../../scripts/scenarios/contracts";
import { withElectronScenario } from "../../scripts/scenarios/harness/electron-e2e-harness";
import {
  NFM_EQUATION_AND_MERMAID_PAGE_KEY,
  NFM_EQUATION_AND_MERMAID_SCENARIO_ID,
} from "../../scripts/scenarios/scenarios/nfm-equation-and-mermaid";
import { openBoardPageFromCard } from "./support/open-board-page";

interface EquationAndMermaidScene {
  readonly editor: Locator;
  readonly mermaidSurface: Locator;
}

async function openEquationAndMermaidScene(
  application: ElectronApplication,
  page: Page,
  manifest: ScenarioManifest,
): Promise<EquationAndMermaidScene> {
  const pageId = manifest.pageIdsByKey[NFM_EQUATION_AND_MERMAID_PAGE_KEY];
  if (!pageId) throw new Error("nfm-equation-and-mermaid has no Page fixture");
  await application.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setBounds({ x: 0, y: 0, width: 1240, height: 900 });
  });
  await page
    .getByRole("button", { name: "Open Equation and Mermaid", exact: true })
    .evaluate((element) => (element as HTMLElement).click());
  await page.getByRole("tab", { name: "Project Home" }).waitFor();
  const card = page.locator(`[data-board-uuid-v7="${pageId}"]`);
  await openBoardPageFromCard({ card, page, tabName: "Exercise Equation and Mermaid" });

  const editor = page
    .locator(`[data-page-stage-page-id="${pageId}"]:visible .nfm-editor:visible`)
    .first();
  const mermaidSurface = editor
    .locator('[data-nfm-code-block-surface][data-language="mermaid"]')
    .first();
  await expect(mermaidSurface).toBeVisible({ timeout: 15_000 });
  return { editor, mermaidSurface };
}

test("Equation and Mermaid survive the public Core-to-Electron document path", async () => {
  test.setTimeout(120_000);
  await withElectronScenario(
    { label: "nfm-equation-and-mermaid", scenarioId: NFM_EQUATION_AND_MERMAID_SCENARIO_ID },
    async ({ application, page, manifest }) => {
      if (!manifest) throw new Error("nfm-equation-and-mermaid did not materialize");
      const { editor, mermaidSurface } = await openEquationAndMermaidScene(
        application,
        page,
        manifest,
      );

      const blockEquations = editor.locator('.bn-block-content[data-content-type="mathBlock"]');
      await expect(blockEquations).toHaveCount(3);
      await expect(editor.locator('[data-inline-content-type="math"]')).toHaveCount(1);
      await expect(blockEquations.locator("math").first()).toBeVisible();
      await expect(editor.locator(".bn-preview-placeholder-error")).toBeVisible();

      const firstEquation = blockEquations.first();
      await firstEquation.locator(".bn-preview-container").click();
      await expect(firstEquation.getByLabel("Equation (LaTeX)")).toBeVisible();
      await expect
        .poll(() => page.evaluate(() => window.getSelection()?.toString()))
        .toBe(String.raw`\int_0^1 x^2 \, dx = \frac{1}{3}`);
      await page.keyboard.press("Escape");

      const inlineEquation = editor.locator('[data-inline-content-type="math"]');
      await inlineEquation.locator(".bn-preview-container").click();
      await expect(inlineEquation.getByLabel("Equation (LaTeX)")).toBeVisible();
      await expect
        .poll(() => page.evaluate(() => window.getSelection()?.toString()))
        .toBe("E = mc^2");
      await page.keyboard.press("Escape");

      await expect(mermaidSurface).toHaveAttribute("data-mermaid-preview-mode", "split");
      await expect(mermaidSurface.locator('[data-nfm-mermaid-status="ready"]')).toBeVisible({
        timeout: 15_000,
      });
      const diagram = mermaidSurface.locator("[data-nfm-mermaid-svg] svg");
      await expect(diagram).toBeVisible();
      const diagramSize = await diagram.evaluate((svg: SVGSVGElement) => ({
        renderedWidth: svg.getBoundingClientRect().width,
        intrinsicWidth: svg.viewBox.baseVal.width,
      }));
      expect(diagramSize.renderedWidth).toBeLessThanOrEqual(diagramSize.intrinsicWidth + 1);
      await expect(
        editor.locator('[data-nfm-code-block-surface][data-language="typescript"]'),
      ).not.toHaveAttribute("data-mermaid-preview-mode", /.+/);

      await mermaidSurface.hover();
      const actionBar = page.getByRole("toolbar", { name: "Code block action bar" });
      await expect(actionBar).toBeVisible();
      await actionBar
        .getByRole("button", { name: "Open language preview format dropdown" })
        .click();
      await page.getByRole("radio", { name: "Show only preview and hide code" }).click();
      await expect(mermaidSurface).toHaveAttribute("data-mermaid-preview-mode", "preview");
      await expect(mermaidSurface.locator("[data-nfm-code-source-region]")).toHaveAttribute(
        "inert",
        "",
      );

      await mermaidSurface
        .getByRole("button", { name: "Click diagram to expand in fullscreen" })
        .click();
      await expect(page.getByRole("dialog", { name: "Mermaid diagram" })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog", { name: "Mermaid diagram" })).toBeHidden();
    },
  );
});
