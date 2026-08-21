import { describe, expect, test } from "vite-plus/test";
import { capturePageCreateSeed } from "./page-create-selection";

const selectNodeContents = (element: HTMLElement): Selection => {
  const selection = window.getSelection();
  if (!selection) throw new Error("Selection API is unavailable");
  selection.removeAllRanges();
  const range = document.createRange();
  range.selectNodeContents(element);
  selection.addRange(range);
  return selection;
};

describe("Page create selection capture", () => {
  test("captures expanded text from a global surface", () => {
    const surface = document.createElement("p");
    surface.textContent = "  Fix   release\nnotes  ";
    document.body.append(surface);

    expect(capturePageCreateSeed(selectNodeContents(surface))).toEqual({
      title: "Fix release notes",
    });

    surface.remove();
  });

  test("ignores editable and local-surface selections", () => {
    const editor = document.createElement("div");
    editor.setAttribute("contenteditable", "true");
    editor.textContent = "Editor title";
    document.body.append(editor);
    expect(capturePageCreateSeed(selectNodeContents(editor))).toBeNull();
    editor.remove();

    const localSurface = document.createElement("div");
    localSurface.dataset.nodexKeyboardScope = "local";
    localSurface.textContent = "Dialog title";
    document.body.append(localSurface);
    expect(capturePageCreateSeed(selectNodeContents(localSurface))).toBeNull();
    localSurface.remove();
  });

  test("ignores a selection that crosses a locally owned surface", () => {
    const surface = document.createElement("div");
    const before = document.createTextNode("Before ");
    const local = document.createElement("span");
    local.dataset.nodexKeyboardScope = "local";
    local.textContent = "local";
    const after = document.createTextNode(" after");
    surface.append(before, local, after);
    document.body.append(surface);

    const selection = window.getSelection();
    if (!selection) throw new Error("Selection API is unavailable");
    const range = document.createRange();
    range.setStart(before, 0);
    range.setEnd(after, after.length);
    selection.removeAllRanges();
    selection.addRange(range);

    expect(capturePageCreateSeed(selection)).toBeNull();
    surface.remove();
  });
});
