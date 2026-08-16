import { expect, test, type Locator } from "@playwright/test";

import { withElectronScenario } from "../../scripts/scenarios/harness/electron-e2e-harness";
import {
  focusBoardDenseProjectHome,
  focusBoardDenseUi,
  observeBoardDenseUi,
} from "../../scripts/scenarios/scenarios/board-dense-ui";
import {
  BOARD_DENSE_PRIMARY_PAGE_KEY,
  BOARD_DENSE_SCENARIO_ID,
} from "../../scripts/scenarios/scenarios/board-dense";
import { LIBRARY_MODULE_CONTRACT_VERSION } from "../../src/shared/library-module";

const focusEditableBlockEnd = async (block: Locator): Promise<void> => {
  await block.evaluate((element) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let editableText: Text | null = null;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (!parent || parent.closest('[contenteditable="false"]')) continue;
      editableText = node as Text;
    }
    if (!editableText) throw new Error("Block has no editable text boundary");
    const range = document.createRange();
    range.setStart(editableText, editableText.data.length);
    range.collapse(true);
    const selection = globalThis.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    element.closest<HTMLElement>('.ProseMirror[contenteditable="true"]')?.focus();
  });
};

test("materializes and opens the authoritative board/dense environment", async ({}, testInfo) => {
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
  }, async ({ harness, application, page, manifest, facts, readRuntimeLogs }) => {
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
    const sourcePageId = manifest.pageIdsByKey[BOARD_DENSE_PRIMARY_PAGE_KEY];
    if (!sourcePageId) throw new Error("board/dense source Page is missing");
    const pageStage = page.locator(
      `[data-page-stage-page-id="${sourcePageId}"]:visible`,
    );
    await expect(pageStage.getByRole("heading", { name: "Rendering contract" }))
      .toBeVisible();
    await expect(pageStage.getByText("Use the authoritative Database projection"))
      .toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);

    const referenceTargetPageId = manifest.pageIdsByKey.boundedProjection;
    if (!referenceTargetPageId) throw new Error("board/dense reference target is missing");
    const seededPageLink = pageStage.getByRole("link", {
      name: "Open projection notes",
    });
    await seededPageLink.click();
    await expect(page.getByRole("tab", { name: "Keep projection updates bounded" }))
      .toHaveAttribute("aria-selected", "true");
    const targetStage = page.locator(
      `[data-page-stage-page-id="${referenceTargetPageId}"]:visible`,
    );
    const referencedBy = targetStage.getByRole("button", { name: /Referenced by 1/u });
    await expect(referencedBy).toBeVisible();
    await referencedBy.click();
    const sourceRows = targetStage.getByRole("button", {
      name: /Unify Database View rendering/u,
    });
    await expect(sourceRows).toHaveCount(3);
    await expect(sourceRows.filter({ hasText: "Mention" })).toHaveCount(1);
    await expect(sourceRows.filter({ hasText: "Embed" })).toHaveCount(1);
    await expect(sourceRows.filter({ hasText: "Link" })).toHaveCount(1);
    await sourceRows.filter({ hasText: "Mention" }).click();
    const sourceTab = page.getByRole("tab", { name: "Unify Database View rendering" });
    await expect(sourceTab)
      .toHaveAttribute("aria-selected", "true");
    await expect.poll(() => page.evaluate(() => {
      const anchor = globalThis.getSelection()?.anchorNode;
      const element = anchor instanceof Element ? anchor : anchor?.parentElement;
      return element
        ?.closest('.bn-block[data-id]')
        ?.textContent
        ?.replace(/\s+/gu, " ")
        .trim() ?? "";
    })).toContain("Related Page");
    await expect(page.getByText("Change Page…", { exact: true })).toHaveCount(0);
    await sourceTab.click();

    const sourceStage = page.locator(
      `[data-page-stage-page-id="${sourcePageId}"]:visible`,
    );
    const sourceEditor = sourceStage.locator(
      '.nfm-editor .ProseMirror[contenteditable="true"]',
    ).first();
    const linkBlock = sourceEditor.locator('.bn-block[data-id]').filter({
      hasText: "Open projection notes",
    }).first();
    await linkBlock.click();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Review /mention a page");
    await page.getByRole("option", { name: /Mention a page/u }).click();
    const mentionDraftBlock = sourceEditor.locator('.bn-block[data-id]').filter({
      hasText: "Review @",
    }).first();
    await expect(mentionDraftBlock).toBeVisible();
    const mentionMenu = page.getByRole("listbox");
    const dateSection = mentionMenu.getByText("Date", { exact: true });
    const pageSection = mentionMenu.getByText("Mention a page", { exact: true });
    await expect(dateSection).toBeVisible();
    await expect(pageSection).toBeVisible();
    const dateSectionBox = await dateSection.boundingBox();
    const pageSectionBox = await pageSection.boundingBox();
    expect(dateSectionBox).not.toBeNull();
    expect(pageSectionBox).not.toBeNull();
    if (!dateSectionBox || !pageSectionBox) {
      throw new Error("Mention section geometry is unavailable");
    }
    expect(dateSectionBox.y).toBeLessThan(pageSectionBox.y);
    const pageRows = mentionMenu.locator('[role="option"][data-mention-kind="page"]');
    const pageMoreRow = mentionMenu.locator(
      '[role="option"][data-mention-kind="page"][data-mention-utility="expand_section"]',
    );
    await expect(pageMoreRow).toBeVisible();
    const pageRowsBeforeExpansion = await pageRows.count();
    const hiddenPageCount = Number.parseInt(await pageMoreRow.innerText(), 10);
    expect(hiddenPageCount).toBeGreaterThan(0);
    await pageMoreRow.click();
    await expect(mentionMenu).toBeVisible();
    await expect(pageMoreRow).toHaveCount(0);
    await expect(pageRows).toHaveCount(
      pageRowsBeforeExpansion - 1 + hiddenPageCount,
    );
    await page.keyboard.type("zzzz");
    await expect(mentionMenu).toBeVisible();
    await expect(mentionMenu.getByText("No matching mentions", { exact: true }))
      .toBeVisible();
    for (let index = 0; index < 4; index += 1) {
      await page.keyboard.press("Backspace");
    }
    await expect(mentionMenu.getByText("Mention a page", { exact: true }))
      .toBeVisible();
    await page.keyboard.type("caus");
    const causalMentionOption = page.getByRole("option", {
      name: /Keep projection updates bounded/u,
    });
    await expect(causalMentionOption.locator(".text-xs"))
      .toContainText("causal coverage");
    await expect(causalMentionOption.locator(".text-xs .font-medium"))
      .toHaveText("causal");
    for (let index = 0; index < 4; index += 1) {
      await page.keyboard.press("Backspace");
    }
    await page.keyboard.type("presrve");
    const fuzzyMentionOption = page.getByRole("option", {
      name: /Preserve local-first identity/u,
    });
    await expect(fuzzyMentionOption).toBeVisible();
    await expect(fuzzyMentionOption.locator(".font-medium"))
      .toHaveText("Preserve");
    for (let index = 0; index < 7; index += 1) {
      await page.keyboard.press("Backspace");
    }
    await page.keyboard.type("Keep projection updates bounded");
    const targetMentionOption = page.getByRole("option", {
      name: /Keep projection updates bounded/u,
    });
    await expect(targetMentionOption)
      .toContainText("Keep projection updates bounded");
    await expect(targetMentionOption.locator(".font-medium"))
      .toHaveCount(4);
    await expect(targetMentionOption.locator("svg"))
      .toHaveAttribute("style", /status-build-dot/u);
    await targetMentionOption.click();
    await page.keyboard.type("tomorrow");
    const insertedMentionBlock = sourceEditor.locator('.bn-block[data-id]').filter({
      hasText: /Review.*tomorrow/u,
    }).first();
    await expect(insertedMentionBlock).toBeVisible();
    const insertedMention = insertedMentionBlock.getByRole("button", {
      name: "Open Page Keep projection updates bounded",
    });
    await expect(insertedMention).toBeVisible();
    await expect(insertedMention.locator("svg"))
      .toHaveAttribute("style", /status-build-dot/u);
    await insertedMention.hover();
    const mentionTooltip = page.locator(
      '[role="tooltip"] [data-page-mention-tooltip="true"]',
    );
    await expect(mentionTooltip).toContainText("Keep projection updates bounded");
    await expect(mentionTooltip).not.toContainText("Database Page");
    await expect(mentionTooltip).toContainText("preserving causal coverage");
    await insertedMention.click();
    await expect(page.getByRole("tab", { name: "Keep projection updates bounded" }))
      .toHaveAttribute("aria-selected", "true");
    await page.getByRole("tab", { name: "Unify Database View rendering" }).click();
    await expect(page.getByRole("tab", { name: "Unify Database View rendering" }))
      .toHaveAttribute("aria-selected", "true");

    await focusEditableBlockEnd(insertedMentionBlock);
    await page.keyboard.press("Enter");
    await page.keyboard.type("/embed page");
    await page.getByRole("option", { name: /Embed page/u }).click();
    await page.getByRole("option", { name: /Keep projection updates bounded/u })
      .click();
    const targetEmbeds = sourceEditor.locator(
      `[data-page-outliner-target="${referenceTargetPageId}"]`,
    );
    await expect(targetEmbeds).toHaveCount(2);
    const insertedEmbed = targetEmbeds.last();
    await expect(insertedEmbed).toHaveAttribute("data-page-outliner-expanded", "false");
    await insertedEmbed.getByRole("button", {
      name: "Expand Keep projection updates bounded",
    }).click();
    await expect(insertedEmbed).toHaveAttribute("data-page-outliner-expanded", "true");
    await expect(insertedEmbed.locator("[data-page-outliner-body]"))
      .toContainText("affected projection window");

    await focusEditableBlockEnd(insertedMentionBlock);
    await page.keyboard.press("Enter");
    await page.keyboard.type("/subpage");
    await page.getByRole("option", { name: /^Subpage/u }).click();
    await page.keyboard.type("Reference model child");
    await page.getByRole("option", { name: /Reference model child/u }).click();
    await expect(sourceEditor.getByRole("button", {
      name: "Edit Reference model child title",
    })).toBeVisible({ timeout: 15_000 });
    const childSearch = await page.evaluate(async ({ projectId, contractVersion }) => {
      return await window.api?.invoke("library-module:read", {
        kind: "project",
        projectId,
      }, {
        version: contractVersion,
        read: {
          mode: "page_reference_candidates",
          query: "Reference model child",
          limit: 5,
        },
      });
    }, {
      projectId: manifest.projectId,
      contractVersion: LIBRARY_MODULE_CONTRACT_VERSION,
    });
    expect(childSearch).toMatchObject({
      ok: true,
      value: {
        value: {
          kind: "page_reference_candidates",
          items: [{
            title: "Reference model child",
            locationLabel: expect.stringContaining("Unify Database View rendering"),
          }],
        },
      },
    });

    const reopenedPage = await harness.restart();
    const reopenedPrimaryTab = reopenedPage.getByRole("tab", {
      name: "Unify Database View rendering",
    });
    await expect(reopenedPrimaryTab).toBeVisible();
    await reopenedPrimaryTab.click();
    await expect(reopenedPrimaryTab).toHaveAttribute("aria-selected", "true");
    const reopenedSourceStage = reopenedPage.locator(
      `[data-page-stage-page-id="${sourcePageId}"]:visible`,
    ).first();
    await expect(reopenedSourceStage).toBeVisible();
    const reopenedEditor = reopenedSourceStage.locator(
      '.nfm-editor .ProseMirror[contenteditable="true"]',
    ).first();
    await expect(reopenedEditor.locator('.bn-block[data-id]').filter({
      hasText: /Review.*tomorrow/u,
    })).toBeVisible();
    await expect(reopenedEditor.locator(
      `[data-page-outliner-target="${referenceTargetPageId}"]`,
    )).toHaveCount(2);
    await expect(reopenedEditor.getByRole("button", {
      name: "Edit Reference model child title",
    })).toBeVisible();

    const pageScreenshot = testInfo.outputPath("page-stage-open.png");
    await reopenedPage.screenshot({ path: pageScreenshot, fullPage: true });
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
