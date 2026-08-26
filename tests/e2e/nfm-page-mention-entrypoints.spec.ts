import { expect, test, type Locator, type Page } from "@playwright/test";

import { withElectronScenario } from "../../scripts/scenarios/harness/electron-e2e-harness";
import { BOARD_DENSE_SCENARIO_ID } from "../../scripts/scenarios/scenarios/board-dense";
import { focusBoardDenseUi } from "../../scripts/scenarios/scenarios/board-dense-ui";

const primaryShortcut = (key: string): string =>
  `${process.platform === "darwin" ? "Meta" : "Control"}+${key}`;

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

const waitForMentionOrFailure = async (page: Page, mention: Locator): Promise<void> => {
  const alert = page.getByRole("alert").last();
  await mention.or(alert).first().waitFor({ state: "visible", timeout: 15_000 });
  if (await mention.isVisible()) return;
  throw new Error(`Page mention creation failed: ${await alert.innerText()}`);
};

test("opens an empty-query Page destination flow and resumes the mention session", async () => {
  test.setTimeout(120_000);
  await withElectronScenario(
    {
      label: "nfm-empty-page-mention-destination",
      scenarioId: BOARD_DENSE_SCENARIO_ID,
    },
    async ({ application, page, manifest }) => {
      if (!manifest) throw new Error("board/dense did not materialize");
      await application.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.setBounds({ x: 0, y: 0, width: 1440, height: 960 });
      });
      await focusBoardDenseUi(page, manifest);

      const sourcePageId = manifest.pageIdsByKey.primaryBuildPage;
      if (!sourcePageId) throw new Error("board/dense has no primary Page");
      const editor = page
        .locator(`[data-page-stage-page-id="${sourcePageId}"]:visible .nfm-editor`)
        .first();
      const sourceBlock = editor
        .locator(".bn-block[data-id]")
        .filter({ hasText: "Keep Board and Page views convergent." })
        .first();
      await focusEditableBlockEnd(sourceBlock);
      await page.keyboard.press("Enter");
      await page.keyboard.type("@");

      await page.getByRole("option", { name: /^Add new page in/u }).click();
      const destinationSearch = page.getByRole("combobox", { name: "Create page in" });
      await expect(destinationSearch).toBeVisible();
      await expect(destinationSearch).toBeFocused();

      await page.keyboard.press("Escape");
      await expect(destinationSearch).toHaveCount(0);
      await page.keyboard.type("draft");
      await expect(editor.locator(".bn-suggestion-temporary-input")).toHaveText("@draft");
    },
  );
});

test("creates Page mentions atomically under current and chosen parent Pages", async () => {
  test.setTimeout(120_000);
  await withElectronScenario(
    {
      label: "nfm-page-mention-entrypoints",
      scenarioId: BOARD_DENSE_SCENARIO_ID,
    },
    async ({ application, page, manifest }) => {
      if (!manifest) throw new Error("board/dense did not materialize");
      await application.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.setBounds({ x: 0, y: 0, width: 1440, height: 960 });
      });
      await focusBoardDenseUi(page, manifest);

      const sourcePageId = manifest.pageIdsByKey.primaryBuildPage;
      if (!sourcePageId) throw new Error("board/dense has no primary Page");
      const editor = page
        .locator(`[data-page-stage-page-id="${sourcePageId}"]:visible .nfm-editor`)
        .first();
      const sourceBlock = editor
        .locator(".bn-block[data-id]")
        .filter({ hasText: "Keep Board and Page views convergent." })
        .first();
      await focusEditableBlockEnd(sourceBlock);
      await page.keyboard.press("Enter");

      const title = "E2E atomic mention child";
      await page.keyboard.type(`+${title}`);
      const temporaryInput = editor.locator(".bn-suggestion-temporary-input");
      await expect(temporaryInput).toHaveText(`+${title}`);
      await expect(temporaryInput).toHaveCSS("outline-width", "5.5px");

      await page.getByRole("option", { name: new RegExp(`New “${title}” sub-page`, "u") }).click();
      const mention = editor.getByRole("link", { name: `Open Page ${title}` });
      await waitForMentionOrFailure(page, mention);
      const href = await mention.getAttribute("href");
      const createdPageId = href?.match(/^nodex:\/\/pages\/(.+)$/u)?.[1];
      if (!createdPageId) throw new Error("Created Page mention has no canonical Page URL");
      const owningShell = editor.locator(`[data-page-outliner-target="${createdPageId}"]`);
      await expect(owningShell).toBeVisible({ timeout: 15_000 });

      await page.keyboard.press(primaryShortcut("z"));
      await expect(mention).toHaveCount(0, { timeout: 15_000 });
      await expect(owningShell).toHaveCount(0, { timeout: 15_000 });
      await expect(
        editor.locator(".bn-block[data-id]").filter({ hasText: `+${title}` }),
      ).toBeVisible();

      await page.keyboard.press(primaryShortcut("Shift+z"));
      await expect(mention).toBeVisible({ timeout: 15_000 });
      await expect(owningShell).toBeVisible({ timeout: 15_000 });
      await expect(mention).toHaveAttribute("href", `nodex://pages/${createdPageId}`);

      const destinationPageId = manifest.pageIdsByKey.boundedProjection;
      if (!destinationPageId) throw new Error("board/dense has no destination Page");
      const remoteTitle = "E2E remote mention child";
      await focusEditableBlockEnd(sourceBlock);
      await page.keyboard.press("Enter");
      await page.keyboard.type(`+${remoteTitle}`);
      await page
        .getByRole("option", { name: new RegExp(`New “${remoteTitle}” page in`, "u") })
        .click();
      const destinationSearch = page.getByRole("combobox", { name: "Create page in" });
      await expect(destinationSearch).toBeVisible();
      await destinationSearch.fill("Keep projection updates bounded");
      await page
        .getByRole("option", { name: /Keep projection updates bounded/u })
        .first()
        .click();

      const remoteMention = editor.getByRole("link", { name: `Open Page ${remoteTitle}` });
      await waitForMentionOrFailure(page, remoteMention);
      const remoteHref = await remoteMention.getAttribute("href");
      const remotePageId = remoteHref?.match(/^nodex:\/\/pages\/(.+)$/u)?.[1];
      if (!remotePageId) throw new Error("Remote Page mention has no canonical Page URL");
      await expect(editor.locator(`[data-page-outliner-target="${remotePageId}"]`)).toHaveCount(0);

      await editor
        .getByRole("link", { name: "Open Page Keep projection updates bounded" })
        .first()
        .click();
      const destinationEditor = page
        .locator(`[data-page-stage-page-id="${destinationPageId}"]:visible .nfm-editor`)
        .first();
      await expect(destinationEditor).toBeVisible();
      await expect(
        destinationEditor.locator(`[data-page-outliner-target="${remotePageId}"]`),
      ).toBeVisible({ timeout: 15_000 });
    },
  );
});
