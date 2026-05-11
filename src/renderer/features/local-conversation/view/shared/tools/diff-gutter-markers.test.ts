import { describe, expect, test } from "bun:test";
import type { FileDiffMetadata } from "@pierre/diffs/react";
import {
  applyFileChangeGutters,
  buildLineMarkers,
  groupMarkersByLine,
  placeDeletionMarker,
} from "./diff-gutter-markers";

function fileDiff(hunkContent: FileDiffMetadata["hunks"][number]["hunkContent"], additionStart = 1): FileDiffMetadata {
  return {
    name: "src/app.ts",
    prevName: undefined,
    type: "change",
    hunks: [{
      collapsedBefore: 0,
      splitLineStart: 1,
      splitLineCount: 1,
      unifiedLineStart: 1,
      unifiedLineCount: 1,
      additionCount: 0,
      additionStart,
      additionLines: 0,
      deletionCount: 0,
      deletionStart: additionStart,
      deletionLines: 0,
      hunkContent,
      hunkContext: undefined,
      hunkSpecs: undefined,
    }],
    splitLineCount: 1,
    unifiedLineCount: 1,
  };
}

function markerSummary(diff: FileDiffMetadata): string {
  return buildLineMarkers(diff)
    .map((marker) => [
      marker.lineNumber,
      marker.kind,
      marker.placement,
      marker.runStart ? "start" : "",
      marker.runEnd ? "end" : "",
    ].join(":"))
    .join("|");
}

describe("diff gutter markers", () => {
  test("marks pure additions on added-side lines", () => {
    const summary = markerSummary(fileDiff([
      { type: "change", additions: ["new a", "new b"], deletions: [], noEOFCRAdditions: false, noEOFCRDeletions: false },
    ], 7));

    expect(summary).toBe("7:addition:line:start:|8:addition:line::end");
  });

  test("marks replacements as modification runs", () => {
    const summary = markerSummary(fileDiff([
      { type: "change", additions: ["new a"], deletions: ["old a"], noEOFCRAdditions: false, noEOFCRDeletions: false },
    ], 3));

    expect(summary).toBe("3:modification:line:start:end");
  });

  test("places top deletion before the current added-side line", () => {
    const placement = placeDeletionMarker({
      currentAdditionLine: 1,
      hunkAdditionStart: 1,
      hasPreviousSurvivingLine: false,
    });

    expect(`${placement.lineNumber}:${placement.placement}`).toBe("1:before");
  });

  test("places after-line deletion after the previous surviving line", () => {
    const summary = markerSummary(fileDiff([
      { type: "context", lines: ["kept"], noEOFCR: false },
      { type: "change", additions: [], deletions: ["removed"], noEOFCRAdditions: false, noEOFCRDeletions: false },
    ], 10));

    expect(summary).toBe("10:deletion:after:start:end");
  });

  test("groups adjacent run start and end markers", () => {
    const grouped = groupMarkersByLine(buildLineMarkers(fileDiff([
      { type: "change", additions: ["one", "two", "three"], deletions: [], noEOFCRAdditions: false, noEOFCRDeletions: false },
    ], 2)));
    const first = grouped.get(2)?.[0] ?? null;
    const middle = grouped.get(3)?.[0] ?? null;
    const last = grouped.get(4)?.[0] ?? null;

    expect(Boolean(first?.runStart)).toBeTrue();
    expect(Boolean(first?.runEnd)).toBeFalse();
    expect(Boolean(middle?.runStart)).toBeFalse();
    expect(Boolean(middle?.runEnd)).toBeFalse();
    expect(Boolean(last?.runStart)).toBeFalse();
    expect(Boolean(last?.runEnd)).toBeTrue();
  });

  test("applies Codex diff DOM gutter attributes", () => {
    const root = document.createElement("diffs-container");
    root.innerHTML = "<span data-column-number=\"4\">4</span><span data-column-number=\"5\">5</span>";

    applyFileChangeGutters(root, groupMarkersByLine(buildLineMarkers(fileDiff([
      { type: "change", additions: ["new"], deletions: [], noEOFCRAdditions: false, noEOFCRDeletions: false },
    ], 4))));

    const markedColumn = root.querySelector<HTMLElement>("[data-column-number='4']");
    const marker = markedColumn?.querySelector<HTMLElement>("[data-file-change-gutter] > [data-file-change-kind]");

    expect(markedColumn?.hasAttribute("data-file-change-gutter-visible") ?? false).toBeTrue();
    expect(marker?.getAttribute("data-file-change-kind") ?? "").toBe("addition");
    expect(marker?.getAttribute("data-file-change-placement") ?? "").toBe("line");
  });
});
