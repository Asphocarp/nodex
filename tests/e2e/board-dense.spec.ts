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

const focusEditableBlockAfterPageMention = async (block: Locator): Promise<void> => {
  await block.evaluate((element) => {
    const mentionRoot = element.querySelector<HTMLElement>(
      '[data-mention-inline-root="true"]',
    );
    if (!mentionRoot) throw new Error("Block has no page mention boundary");
    const mentionNodeView = mentionRoot.closest<HTMLElement>(
      ".bn-ic-react-node-view-renderer",
    ) ?? mentionRoot;

    const range = document.createRange();
    range.setStartAfter(mentionNodeView);
    range.collapse(true);
    const selection = globalThis.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    element.closest<HTMLElement>('.ProseMirror[contenteditable="true"]')?.focus();
  });
};

const readPageMentionHighlight = async (mention: Locator) => {
  return mention.evaluate((element) => {
    const style = globalThis.getComputedStyle(element, "::before");
    return {
      opacity: style.opacity,
      backgroundColor: style.backgroundColor,
      left: style.left,
      right: style.right,
      top: style.top,
      bottom: style.bottom,
    };
  });
};

const readOpaqueSurfaceStyle = async (surface: Locator) => {
  return surface.evaluate((element) => {
    const style = globalThis.getComputedStyle(element);
    return {
      backgroundColor: style.backgroundColor,
      backgroundImage: style.backgroundImage,
    };
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
    const editorPageLink = linkBlock.getByRole("link", {
      name: "Open projection notes",
    });
    const editorPageLinkStyle = await editorPageLink.evaluate((element) => {
      const style = globalThis.getComputedStyle(element);
      const editor = element.closest<HTMLElement>(".nfm-editor")
        ?.querySelector<HTMLElement>(".bn-editor");
      const expectedColorProbe = document.createElement("span");
      expectedColorProbe.style.color =
        "color-mix(in srgb, var(--color-token-text-link-foreground) 80%, var(--color-token-foreground) 20%)";
      document.body.append(expectedColorProbe);
      const expectedColor = globalThis.getComputedStyle(expectedColorProbe).color;
      expectedColorProbe.remove();
      return {
        color: style.color,
        expectedColor,
        editorColor: editor ? globalThis.getComputedStyle(editor).color : null,
        fontWeight: style.fontWeight,
        paddingLeft: style.paddingLeft,
        paddingRight: style.paddingRight,
        textDecorationLine: style.textDecorationLine,
      };
    });
    expect(editorPageLinkStyle.color).toBe(editorPageLinkStyle.expectedColor);
    expect(editorPageLinkStyle.color).not.toBe(editorPageLinkStyle.editorColor);
    expect(editorPageLinkStyle.fontWeight).toBe("500");
    expect(editorPageLinkStyle.paddingLeft).toBe("0px");
    expect(editorPageLinkStyle.paddingRight).toBe("0px");
    expect(editorPageLinkStyle.textDecorationLine).toBe("none");
    await editorPageLink.hover();
    const linkToolbar = page.getByRole("toolbar", { name: "Link actions" });
    await expect(linkToolbar).toBeVisible();
    await expect(linkToolbar.getByRole("button", { name: "Edit" })).toBeVisible();
    await expect(linkToolbar.getByRole("button", { name: "Clear" })).toBeVisible();
    await expect(linkToolbar.getByRole("button", { name: "Copy" })).toBeVisible();
    await expect(linkToolbar.getByRole("button", { name: "Open" })).toBeVisible();
    await expect(linkToolbar.getByRole("button", { name: "Copy" }).getByText("Copy", { exact: true })).toHaveCount(0);
    await expect(linkToolbar.getByRole("button", { name: "Open" }).getByText("Open", { exact: true })).toHaveCount(0);
    const compactToolbarSurface = await readOpaqueSurfaceStyle(linkToolbar);
    expect(compactToolbarSurface.backgroundImage).toBe("none");
    expect(compactToolbarSurface.backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
    const compactToolbarBox = await linkToolbar.boundingBox();
    expect(compactToolbarBox).not.toBeNull();
    if (!compactToolbarBox) throw new Error("Link toolbar geometry is unavailable");
    const editorPageLinkBox = await editorPageLink.boundingBox();
    expect(editorPageLinkBox).not.toBeNull();
    if (!editorPageLinkBox) throw new Error("Editor link geometry is unavailable");
    expect(compactToolbarBox.y).toBeGreaterThanOrEqual(editorPageLinkBox.y + editorPageLinkBox.height);
    await linkToolbar.getByRole("button", { name: "Edit" }).click();
    const editToolbar = page.getByRole("toolbar", { name: "Edit link" });
    await expect(editToolbar).toBeVisible();
    await expect(editToolbar.getByRole("textbox", { name: "Type or paste a link" })).toBeVisible();
    await expect(editToolbar.getByRole("button", { name: "Apply link" })).toBeVisible();
    await expect(editToolbar.getByRole("textbox", { name: "Link title" })).toHaveCount(0);
    const editToolbarSurface = await readOpaqueSurfaceStyle(editToolbar);
    expect(editToolbarSurface.backgroundImage).toBe("none");
    expect(editToolbarSurface.backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
    const applyButton = editToolbar.getByRole("button", { name: "Apply link" });
    const applyButtonStyle = await applyButton.evaluate((element) => {
      const style = globalThis.getComputedStyle(element);
      return {
        backgroundColor: style.backgroundColor,
        borderRadius: style.borderRadius,
        padding: style.padding,
      };
    });
    expect(applyButtonStyle.backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
    expect(applyButtonStyle.borderRadius).not.toBe("0px");
    expect(applyButtonStyle.padding).toBe("0px");
    const editApplyIconBox = await applyButton.locator("svg").boundingBox();
    expect(editApplyIconBox).not.toBeNull();
    if (!editApplyIconBox) throw new Error("Link apply icon geometry is unavailable");
    expect(editApplyIconBox.width).toBeCloseTo(12, 0);
    expect(editApplyIconBox.height).toBeCloseTo(12, 0);
    const editToolbarBox = await editToolbar.boundingBox();
    expect(editToolbarBox).not.toBeNull();
    if (!editToolbarBox) throw new Error("Link edit toolbar geometry is unavailable");
    expect(editToolbarBox.height).toBeCloseTo(compactToolbarBox.height, 0);
    await page.keyboard.press("Escape");
    await editorPageLink.hover();
    await expect(linkToolbar).toBeVisible();
    const editorPageLinkHoverStyle = await editorPageLink.evaluate((element) => {
      const style = globalThis.getComputedStyle(element);
      return {
        textDecorationLine: style.textDecorationLine,
        textDecorationStyle: style.textDecorationStyle,
        textDecorationThickness: style.textDecorationThickness,
        textUnderlineOffset: style.textUnderlineOffset,
      };
    });
    expect(editorPageLinkHoverStyle).toEqual({
      textDecorationLine: "underline",
      textDecorationStyle: "dashed",
      textDecorationThickness: "0.5px",
      textUnderlineOffset: "2px",
    });
    await page.mouse.move(0, 0);
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
    const insertedMention = insertedMentionBlock.getByRole("link", {
      name: "Open Page Keep projection updates bounded",
    });
    await expect(insertedMention).toBeVisible();
    await expect(insertedMention).toHaveAttribute("tabindex", "0");
    await expect(insertedMention).toHaveAttribute("contenteditable", "false");
    await expect(insertedMention).toHaveAttribute(
      "data-page-mention-inline-anchor",
      "true",
    );
    const insertedMentionStyle = await insertedMention.evaluate((element) => {
      const style = globalThis.getComputedStyle(element);
      const editor = element.closest<HTMLElement>(".nfm-editor")
        ?.querySelector<HTMLElement>(".bn-editor");
      return {
        color: style.color,
        editorColor: editor ? globalThis.getComputedStyle(editor).color : null,
        opacity: style.opacity,
        paddingLeft: style.paddingLeft,
        paddingRight: style.paddingRight,
      };
    });
    expect(insertedMentionStyle.color).toBe(insertedMentionStyle.editorColor);
    expect(insertedMentionStyle.opacity).toBe("1");
    expect(insertedMentionStyle.paddingLeft).toBe("0px");
    expect(insertedMentionStyle.paddingRight).toBe("0px");
    await expect(insertedMention.locator("svg"))
      .toHaveAttribute("style", /status-build-dot/u);
    const mentionLabel = insertedMention.locator("span").filter({
      hasText: "Keep projection updates bounded",
    }).last();
    const mentionRestUnderlineStyle = await mentionLabel.evaluate((element) => {
      const style = globalThis.getComputedStyle(element);
      return {
        color: style.color,
        textDecorationLine: style.textDecorationLine,
        textDecorationStyle: style.textDecorationStyle,
        textDecorationColor: style.textDecorationColor,
        textDecorationThickness: style.textDecorationThickness,
        textUnderlineOffset: style.textUnderlineOffset,
      };
    });
    expect(mentionRestUnderlineStyle).toMatchObject({
      textDecorationLine: "underline",
      textDecorationStyle: "solid",
      textUnderlineOffset: "10%",
    });
    expect(Number.parseFloat(mentionRestUnderlineStyle.textDecorationThickness)).toBeGreaterThan(0);
    expect(mentionRestUnderlineStyle.textDecorationColor)
      .not.toBe(mentionRestUnderlineStyle.color);
    await insertedMention.hover();
    const mentionHoverUnderlineStyle = await mentionLabel.evaluate((element) => {
      const style = globalThis.getComputedStyle(element);
      return {
        color: style.color,
        textDecorationLine: style.textDecorationLine,
        textDecorationStyle: style.textDecorationStyle,
        textDecorationColor: style.textDecorationColor,
        textDecorationThickness: style.textDecorationThickness,
        textUnderlineOffset: style.textUnderlineOffset,
      };
    });
    expect(mentionHoverUnderlineStyle).toMatchObject({
      textDecorationLine: "underline",
      textDecorationStyle: "solid",
      textUnderlineOffset: "10%",
    });
    expect(Number.parseFloat(mentionHoverUnderlineStyle.textDecorationThickness)).toBeGreaterThan(0);
    expect(mentionHoverUnderlineStyle.textDecorationColor)
      .toBe(mentionRestUnderlineStyle.textDecorationColor);
    const mentionTooltip = page.locator(
      '[role="tooltip"] [data-page-mention-tooltip="true"]',
    );
    await expect(mentionTooltip).toContainText("Keep projection updates bounded");
    await expect(mentionTooltip).not.toContainText("Database Page");
    await expect(mentionTooltip).toContainText("preserving causal coverage");
    const hoverHighlight = await readPageMentionHighlight(insertedMention);
    expect(hoverHighlight.opacity).toBe("1");
    expect(Number.parseFloat(hoverHighlight.left)).toBeLessThan(0);
    expect(Number.parseFloat(hoverHighlight.right)).toBeLessThan(0);
    expect(Number.parseFloat(hoverHighlight.top)).toBeLessThan(0);
    expect(Number.parseFloat(hoverHighlight.bottom)).toBeLessThan(0);
    await page.mouse.move(0, 0);
    await focusEditableBlockAfterPageMention(insertedMentionBlock);
    await page.keyboard.press("ArrowLeft");
    await expect.poll(() => insertedMention.getAttribute(
      "data-mention-token-selected",
    )).toBe("true");
    const mentionFocusAffordance = page.locator(
      '[data-mention-inline-focus-affordance="true"]',
    );
    await expect(mentionFocusAffordance).toBeVisible();
    await expect(mentionFocusAffordance).toHaveText("Open page↵");
    const mentionBounds = await insertedMention.boundingBox();
    const affordanceBounds = await mentionFocusAffordance.boundingBox();
    expect(mentionBounds).not.toBeNull();
    expect(affordanceBounds).not.toBeNull();
    if (!mentionBounds || !affordanceBounds) {
      throw new Error("Mention focus affordance geometry is unavailable");
    }
    expect(affordanceBounds.y).toBeGreaterThan(mentionBounds.y + mentionBounds.height);
    expect(
      Math.abs(
        affordanceBounds.x + affordanceBounds.width / 2
          - (mentionBounds.x + mentionBounds.width),
      ),
    ).toBeLessThan(2);
    const selectedHighlight = await readPageMentionHighlight(insertedMention);
    expect(selectedHighlight).toEqual(hoverHighlight);
    const pageMentionSelection = await insertedMentionBlock.evaluate((element) => {
      const mentionRoot = element.querySelector<HTMLElement>(
        '[data-mention-inline-root="true"]',
      );
      const editor = mentionRoot?.closest<HTMLElement>(
        '.ProseMirror[contenteditable="true"]',
      );
      const mentionChip = mentionRoot?.querySelector<HTMLElement>(
        '[data-mention-inline-chip="true"]',
      );
      return {
        editorOwnsFocus: Boolean(editor?.contains(document.activeElement)),
        mentionIsSelected: mentionChip?.dataset.mentionTokenSelected === "true",
        nativeTextSelectionHidden: editor?.classList.contains(
          "ProseMirror-hideselection",
        ),
      };
    });
    expect(pageMentionSelection).toEqual({
      editorOwnsFocus: true,
      mentionIsSelected: true,
      nativeTextSelectionHidden: true,
    });
    const mentionFocusUnderlineStyle = await mentionLabel.evaluate((element) => {
      const style = globalThis.getComputedStyle(element);
      return {
        color: style.color,
        textDecorationLine: style.textDecorationLine,
        textDecorationStyle: style.textDecorationStyle,
        textDecorationColor: style.textDecorationColor,
        textDecorationThickness: style.textDecorationThickness,
        textUnderlineOffset: style.textUnderlineOffset,
      };
    });
    expect(mentionFocusUnderlineStyle).toMatchObject({
      textDecorationLine: "underline",
      textDecorationStyle: "solid",
      textUnderlineOffset: "10%",
    });
    expect(mentionFocusUnderlineStyle.textDecorationColor)
      .toBe(mentionFocusUnderlineStyle.color);
    await page.keyboard.press("Enter");
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
    const childSearch = await page.evaluate(async ({ projectId }) => {
      return await window.api?.invoke("library-module:read", {
        kind: "project",
        projectId,
      }, {
        read: {
          mode: "page_reference_candidates",
          query: "Reference model child",
          limit: 5,
        },
      });
    }, {
      projectId: manifest.projectId,
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
