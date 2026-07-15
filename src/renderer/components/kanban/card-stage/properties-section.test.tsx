import { describe, expect, test, vi } from "vitest";

import type { CardStageCoreCard } from "@/lib/card-stage-card";
import { render } from "@/test/dom";
import { CardStagePropertiesSection } from "./properties-section";
import type { CardStageController } from "./use-card-stage-controller";

const card = {
  id: "nested-card",
  archived: false,
  title: "Nested Card",
  richTitle: [],
  isAllDay: false,
  reminders: [],
  revision: 1,
  created: new Date("2026-07-15T00:00:00.000Z"),
} satisfies CardStageCoreCard;

const buildController = (
  overrides: Partial<CardStageController> = {},
): CardStageController => ({
  card,
  hasDatabaseProperties: false,
  hasThreadsRow: false,
  ...overrides,
}) as CardStageController;

describe("CardStagePropertiesSection", () => {
  test("omits the section when the Card has no property rows", () => {
    const view = render(
      <CardStagePropertiesSection controller={buildController()} />,
    );

    expect(view.container.firstChild).toBeNull();
    expect(view.queryByText("Properties")).toBeNull();
  });

  test("keeps the section when a standalone Card has a Threads row", () => {
    const view = render(
      <CardStagePropertiesSection
        controller={buildController({
          hasThreadsRow: true,
          linkedCodexThreads: [],
          onOpenNewCodexThread: vi.fn(),
          runInTarget: "localProject",
          runInLocalPathDisplay: "",
          runInWorktreePathDisplay: "",
          propertiesExpanded: false,
          showCollapsedProperties: true,
          collapseThreadsByDefault: false,
          collapsedPropertyCount: 0,
          saving: false,
        })}
      />,
    );

    expect(view.getByText("Properties")).toBeTruthy();
    expect(view.getByRole("button", { name: "New" })).toBeTruthy();
  });
});
