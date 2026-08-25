import { describe, expect, test, vi } from "vite-plus/test";
import { act, fireEvent } from "@testing-library/react";

import type { PageStageCorePage } from "@/lib/page-stage-page";
import { render } from "@/test/dom";
import { PageStagePropertiesSection } from "./properties-section";
import type { PageStageController } from "./use-page-stage-controller";
import type { PageStagePropertyControls } from "./use-page-stage-properties";

const page = {
  id: "nested-page",
  pageKey: null,
  archived: false,
  title: "Nested Page",
  richTitle: [],
  isAllDay: false,
  reminders: [],
  revision: 1,
  created: new Date("2026-07-15T00:00:00.000Z"),
} satisfies PageStageCorePage;

const emptyPropertyControls: PageStagePropertyControls = {
  pageId: null,
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
  replaceRelation: async () => ({ status: "updated", didMutate: false }),
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

const buildController = (overrides: Partial<PageStageController> = {}): PageStageController =>
  ({
    page,
    hasDatabaseProperties: false,
    hasRelatedChatsRow: false,
    propertyControls: emptyPropertyControls,
    ...overrides,
  }) as PageStageController;

describe("PageStagePropertiesSection", () => {
  test("omits the section when the Page has no property rows", () => {
    const view = render(<PageStagePropertiesSection controller={buildController()} />);

    expect(view.container.firstChild).toBeNull();
    expect(view.queryByText("Properties")).toBeNull();
  });

  test("uses the shared Empty value to add a related Chat without execution controls", async () => {
    const onCreateRelatedChat = vi.fn(async () => undefined);
    const view = render(
      <PageStagePropertiesSection
        controller={buildController({
          hasRelatedChatsRow: true,
          relatedChats: [],
          relatedChatCandidates: [],
          onCreateRelatedChat,
          propertiesExpanded: false,
          showCollapsedProperties: true,
          collapseThreadsByDefault: false,
          collapsedPropertyCount: 0,
          saving: false,
        })}
      />,
    );

    expect(view.getByText("Properties")).toBeTruthy();
    expect(view.getByText("Linked chats")).toBeTruthy();
    expect(view.getByRole("button", { name: "Add chat" }).textContent).toBe("Empty");
    expect(view.queryByText("Local project")).toBeNull();
    expect(view.queryByText("Project cwd")).toBeNull();

    await act(async () => {
      fireEvent.pointerDown(view.getByRole("button", { name: "Add chat" }), {
        button: 0,
        ctrlKey: false,
      });
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.click(view.getByRole("menuitem", { name: "New chat" }));
      await Promise.resolve();
    });
    expect(onCreateRelatedChat).toHaveBeenCalledTimes(1);
  });

  test("shows Chat relation chips and links an existing Chat from the trailing action", async () => {
    const handleOpenRelatedChat = vi.fn(async () => undefined);
    const handleRemoveRelatedChat = vi.fn(async () => undefined);
    const onLinkRelatedChat = vi.fn(async () => undefined);
    const view = render(
      <PageStagePropertiesSection
        controller={buildController({
          hasRelatedChatsRow: true,
          relatedChats: [
            {
              sessionId: "session-threadless",
              projectId: "project-1",
              projectName: "Nodex",
              displayTitle: "Research follow-up",
              threadId: null,
              threadPreview: "",
              threadStatus: null,
              threadArchived: false,
              unread: false,
              sessionArchived: false,
              conversationRecencyAt: null,
              linkedAt: "2026-08-24T00:00:00Z",
            },
          ],
          relatedChatsLoading: false,
          relatedChatsError: null,
          relatedChatsHasMore: false,
          relatedChatsLoadingMore: false,
          relatedChatCandidates: [
            {
              sessionId: "session-candidate",
              displayTitle: "Implementation plan",
              projectName: "Nodex",
            },
          ],
          onCreateRelatedChat: vi.fn(async () => undefined),
          onLinkRelatedChat,
          onOpenRelatedChat: handleOpenRelatedChat,
          onRemoveRelatedChat: handleRemoveRelatedChat,
          handleOpenRelatedChat,
          handleRemoveRelatedChat,
          currentSessionId: "session-threadless",
          propertiesExpanded: false,
          showCollapsedProperties: true,
          collapseThreadsByDefault: false,
          collapsedPropertyCount: 0,
          saving: false,
        })}
      />,
    );

    expect(view.queryByText("Nodex")).toBeNull();
    expect(view.queryByText("No thread yet")).toBeNull();
    expect(view.queryByText("1 linked")).toBeNull();
    expect(
      view.getByRole("button", { name: /^Research follow-up/ }).getAttribute("aria-current"),
    ).toBe("true");
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: /^Research follow-up/ }));
      fireEvent.click(view.getByRole("button", { name: "Remove relation to Research follow-up" }));
      await Promise.resolve();
    });
    expect(handleOpenRelatedChat).toHaveBeenCalledWith("session-threadless");
    expect(handleRemoveRelatedChat).toHaveBeenCalledWith("session-threadless");

    await act(async () => {
      fireEvent.pointerDown(view.getByRole("button", { name: "Add chat" }), {
        button: 0,
        ctrlKey: false,
      });
      await Promise.resolve();
    });
    const linkExisting = view.getByRole("menuitem", { name: "Link to chat…" });
    await act(async () => {
      fireEvent.click(linkExisting);
      await Promise.resolve();
    });
    const candidate = await view.findByRole("button", { name: /Implementation plan/ });
    await act(async () => {
      fireEvent.click(candidate);
      await Promise.resolve();
    });
    expect(onLinkRelatedChat).toHaveBeenCalledWith("session-candidate");
  });
});
