import { describe, expect, test, vi } from "vitest";

import type { PageStageCorePage } from "@/lib/page-stage-page";
import { render } from "@/test/dom";
import { PageStagePropertiesSection } from "./properties-section";
import type { PageStageController } from "./use-page-stage-controller";
import type { PageStagePropertyControls } from "./use-page-stage-properties";

const page = {
  id: "nested-page",
  archived: false,
  title: "Nested Page",
  richTitle: [],
  isAllDay: false,
  reminders: [],
  revision: 1,
  created: new Date("2026-07-15T00:00:00.000Z"),
} satisfies PageStageCorePage;

const emptyPropertyControls: PageStagePropertyControls = {
  properties: [],
  primaryProperties: [],
  sectionProperties: [],
  semanticValues: null,
  hasScheduleCapability: false,
  options: {},
  optionRegistryStates: {},
  requestOptions: vi.fn(),
  requestMoreOptions: vi.fn(),
  optionRegistryHasMore: {},
  optionRegistryLoadingMore: {},
  busyPropertyIds: new Set(),
  errors: {},
  edit: async () => ({ status: "updated", didMutate: false }),
  patchRelation: async () => ({ status: "updated", didMutate: false }),
  patchMultiSelect: async () => ({ status: "updated", didMutate: false }),
  createOptionAndSelect: async () => ({ status: "updated", didMutate: false }),
  loadRelationTargets: async (property) => ({
    valueRevision: property.valueRevision,
    totalCount: 0,
    targets: [],
    nextCursor: null,
    projectionRevision: 0,
  }),
  searchRelationCandidates: async () => ({
    candidates: [],
    nextCursor: null,
    projectionRevision: 0,
  }),
  loadRelationTargetDescriptor: async () => null,
  refreshRelationValue: async () => undefined,
};

const buildController = (
  overrides: Partial<PageStageController> = {},
): PageStageController => ({
  page,
  hasDatabaseProperties: false,
  hasThreadsRow: false,
  propertyControls: emptyPropertyControls,
  ...overrides,
}) as PageStageController;

describe("PageStagePropertiesSection", () => {
  test("omits the section when the Page has no property rows", () => {
    const view = render(
      <PageStagePropertiesSection controller={buildController()} />,
    );

    expect(view.container.firstChild).toBeNull();
    expect(view.queryByText("Properties")).toBeNull();
  });

  test("keeps the section when a standalone Page has a Threads row", () => {
    const view = render(
      <PageStagePropertiesSection
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
