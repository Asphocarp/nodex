import { act } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, test } from "vitest";

import type {
  DatabasePage,
  PageInput,
} from "@/lib/types";
import type { PageStagePageModel } from "@/lib/page-stage-page";
import { render, settleAsyncRender } from "@/test/dom";
import {
  PAGE_DOCUMENT_SCHEMA_VERSION,
  plainTextToPortableRichText,
} from "../../../../shared/block-documents";
import {
  usePageStageController,
  type PageStageControllerDependencies,
} from "./use-page-stage-controller";
import type { PageStageProps } from "./types";

type PageStageController = ReturnType<typeof usePageStageController>;

function buildPage(overrides: Partial<DatabasePage> = {}): DatabasePage {
  const title = overrides.title ?? "Projected title";
  return {
    id: "page-1",
    status: "build",
    archived: false,
    title,
    richTitle: plainTextToPortableRichText(title),
    description: "Projected body",
    tags: [],
    created: new Date("2026-01-01T00:00:00.000Z"),
    order: 1,
    ...overrides,
  };
}

function updatedResult(
  page: DatabasePage,
  updates: Partial<PageInput>,
) {
  void page;
  void updates;
  return { status: "updated", didMutate: true } as const;
}

function toStageModel(page: DatabasePage): PageStagePageModel {
  return {
    page: {
      id: page.id,
      archived: page.archived,
      title: page.title,
      richTitle: page.richTitle,
      isAllDay: Boolean(page.isAllDay),
      recurrence: page.recurrence,
      reminders: page.reminders ?? [],
      scheduleTimezone: page.scheduleTimezone,
      runInTarget: page.runInTarget,
      runInLocalPath: page.runInLocalPath,
      runInBaseBranch: page.runInBaseBranch,
      runInWorktreePath: page.runInWorktreePath,
      runInEnvironmentPath: page.runInEnvironmentPath,
      revision: page.revision ?? 1,
      created: page.created,
    },
    databaseContext: {
      kind: "member",
      membership: {
        id: "membership-1",
        dataSourceId: "source-1",
        databaseId: "database-1",
        revision: 1,
      },
      compatibilityProperties: {
        status: page.status,
        priority: page.priority,
        estimate: page.estimate,
        tags: page.tags,
        dueDate: page.dueDate,
        scheduledStart: page.scheduledStart,
        scheduledEnd: page.scheduledEnd,
        assignee: page.assignee,
      },
    },
  };
}

function documentAuthority(): PageStageProps["documentAuthority"] {
  return {
    kind: "yjs",
    descriptor: {
      projectId: "project-1",
      ownerBlockId: "page-1",
      ownerType: "page",
      ownerLifecycle: "active",
      documentId: "document-1",
      storeEpoch: "store-epoch-1",
      generation: 1,
      headSeq: 1,
      schemaKey: "nodex.page",
      schemaVersion: PAGE_DOCUMENT_SCHEMA_VERSION,
      readiness: "ready",
      sync: { kind: "yjs", stateVector: new Uint8Array() },
    },
    reload: async () => undefined,
  };
}

function buildProps(overrides: Partial<PageStageProps> = {}): PageStageProps {
  const sourcePage = buildPage();
  const page = overrides.page === undefined ? toStageModel(sourcePage) : overrides.page;
  return {
    page,
    documentAuthority: documentAuthority(),
    projectId: "project-1",
    availableTags: [],
    onClose: () => undefined,
    onUpdate: async (_pageId, updates) =>
      updatedResult(sourcePage, updates),
    onDelete: async () => undefined,
    onMove: async () => undefined,
    ...overrides,
  };
}

function renderController(
  props: PageStageProps,
  dependencies: PageStageControllerDependencies = {},
) {
  let controller: PageStageController | null = null;
  let renderCount = 0;

  function Harness({ nextProps, children }: {
    nextProps: PageStageProps;
    children?: ReactNode;
  }) {
    renderCount += 1;
    controller = usePageStageController(nextProps, dependencies);
    return <>{children}</>;
  }

  const view = render(<Harness nextProps={props} />);
  if (!controller) throw new Error("Expected Page Detail controller to render");

  return {
    view,
    get controller(): PageStageController {
      if (!controller) throw new Error("Expected Page Detail controller");
      return controller;
    },
    get renderCount(): number {
      return renderCount;
    },
    rerender(nextProps: PageStageProps): void {
      view.rerender(<Harness nextProps={nextProps} />);
    },
  };
}

describe("usePageStageController", () => {
  test("does not resynchronize an unchanged metadata revision when command props are recreated", async () => {
    const initialPage = buildPage();
    const result = renderController(buildProps({
      page: toStageModel(initialPage),
      onUpdate: async (_pageId, patch) => updatedResult(initialPage, patch),
    }));
    await settleAsyncRender();
    const settledRenderCount = result.renderCount;

    const equivalentPage = buildPage();
    await act(async () => {
      result.rerender(buildProps({
        page: toStageModel(equivalentPage),
        onUpdate: async (_pageId, patch) => updatedResult(equivalentPage, patch),
      }));
      await Promise.resolve();
    });
    await settleAsyncRender();

    expect(result.renderCount - settledRenderCount).toBe(1);
  });

  test("keeps collaborative title changes out of metadata writes", async () => {
    const updates: Partial<PageInput>[] = [];
    const leftTitles: string[] = [];
    const liveTitles: string[] = [];
    let persisted = 0;
    const result = renderController(
      buildProps({
        onLeavePage: (snapshot) => leftTitles.push(snapshot.titleSnapshot),
        onTitleChange: (title) => liveTitles.push(title),
        onUpdate: async (_pageId, patch) => {
          updates.push(patch);
          return updatedResult(buildPage(), patch);
        },
      }),
      {
        persistDocument: async () => {
          persisted += 1;
        },
      },
    );
    await settleAsyncRender();

    act(() => result.controller.handleDocumentTitleChange("Live Y.Text title"));
    await act(async () => result.controller.handleClose());

    expect(persisted).toBe(1);
    expect(updates.length).toBe(0);
    expect(liveTitles).toEqual(["Live Y.Text title"]);
    expect(leftTitles.join(",")).toBe("Live Y.Text title");
  });

  test("persists freeform metadata without title or description fields", async () => {
    const updates: Partial<PageInput>[] = [];
    const result = renderController(buildProps({
      onUpdate: async (_pageId, patch) => {
        updates.push(patch);
        return updatedResult(buildPage(), patch);
      },
    }));
    await settleAsyncRender();

    act(() => result.controller.handleAssigneeChange("alex"));
    await settleAsyncRender();
    act(() => result.controller.handleAssigneeBlur());
    await settleAsyncRender();

    expect(updates.length).toBe(1);
    expect(updates[0]?.assignee).toBe("alex");
    expect(Object.hasOwn(updates[0] ?? {}, "title")).toBe(false);
    expect(Object.hasOwn(updates[0] ?? {}, "description")).toBe(false);
  });

  test("does not offer or perform a stale whole-page overwrite after a property conflict", async () => {
    const updates: Partial<PageInput>[] = [];
    const latest = buildPage({ priority: "p0-critical", revision: 4 });
    const result = renderController(buildProps({
      onUpdate: async (_pageId, patch) => {
        updates.push(patch);
        return {
          status: "conflict",
          projectId: "project-1",
          pageId: latest.id,
          revision: 4,
          page: latest,
          conflictedFields: ["priority"],
        };
      },
    }));
    await settleAsyncRender();

    act(() => result.controller.handlePriorityChange("p1-high"));
    await settleAsyncRender();

    expect(updates.length).toBe(1);
    expect(updates[0]?.priority).toBe("p1-high");
    expect("handleOverwriteMine" in result.controller).toBe(false);
  });

  test("flushes metadata and the owned Document together on close", async () => {
    const updates: Partial<PageInput>[] = [];
    let persisted = 0;
    const result = renderController(
      buildProps({
        onUpdate: async (_pageId, patch) => {
          updates.push(patch);
          return updatedResult(buildPage(), patch);
        },
      }),
      {
        persistDocument: async () => {
          persisted += 1;
        },
      },
    );
    await settleAsyncRender();

    act(() => result.controller.handleAssigneeChange("alex"));
    await settleAsyncRender();
    await act(async () => result.controller.handleClose());

    expect(persisted).toBe(1);
    expect(updates.length).toBe(1);
    expect(updates[0]?.assignee).toBe("alex");
    expect(Object.hasOwn(updates[0] ?? {}, "title")).toBe(false);
    expect(Object.hasOwn(updates[0] ?? {}, "description")).toBe(false);
  });
});
