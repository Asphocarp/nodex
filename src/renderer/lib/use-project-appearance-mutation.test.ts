import {
  QueryClient,
  QueryClientProvider,
  type InfiniteData,
} from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PROJECT_APPEARANCE } from "../../shared/project-appearance";
import { queryKeys } from "./query-keys";
import type { Project, ProjectWindow } from "./types";
import {
  patchProjectAppearanceInWindow,
  useProjectAppearanceMutation,
} from "./use-project-appearance-mutation";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  toastDanger: vi.fn(),
}));

vi.mock("./api", () => ({
  invoke: mocks.invoke,
}));

vi.mock("@/components/ui/toast", () => ({
  toast: {
    danger: mocks.toastDanger,
  },
}));

function projectWindow(): InfiniteData<ProjectWindow, string | null> {
  return {
    pageParams: [null],
    pages: [{
      items: [{
        id: "project-1",
        libraryId: "library-1",
        databaseId: "database-1",
        defaultDatabaseViewId: "view-1",
        lifecycle: "active",
        bindingRevision: 1,
        name: "Nodex",
        description: "",
        appearance: DEFAULT_PROJECT_APPEARANCE,
        sources: [],
        primaryWorkspaceRoot: null,
        pinned: false,
        pinnedOrder: null,
        created: new Date(0),
        updated: new Date(0),
      }],
      nextCursor: null,
      hasMore: false,
      projectionRevision: 1,
    }],
  };
}

function projectFromWindow(): Project {
  const project = projectWindow().pages[0]?.items[0];
  if (!project) throw new Error("Expected Project fixture");
  return project;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function setupHook() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  client.setQueryData(queryKeys.projects.list(false), projectWindow());
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
  const project = projectFromWindow();
  const hook = renderHook(
    ({ currentProject }: { currentProject: Project }) =>
      useProjectAppearanceMutation(currentProject),
    {
      initialProps: { currentProject: project },
      wrapper,
    },
  );
  const readAppearance = () => {
    const current = client.getQueryData<
      InfiniteData<ProjectWindow, string | null>
    >(queryKeys.projects.list(false));
    return current?.pages[0]?.items[0]?.appearance;
  };
  return { client, hook, project, readAppearance };
}

const RED_FOLDER = {
  color: "red",
  marker: { kind: "icon", icon: "folder" },
} as const;
const RED_HEART = {
  color: "red",
  marker: { kind: "icon", icon: "heart" },
} as const;

describe("patchProjectAppearanceInWindow", () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
    mocks.toastDanger.mockReset();
  });

  it("updates only the matching Project in paged catalog data", () => {
    const current = projectWindow();
    const appearance = {
      color: "red",
      marker: { kind: "icon", icon: "heart" },
    } as const;
    const next = patchProjectAppearanceInWindow(current, "project-1", appearance);

    expect(next?.pages[0]?.items[0]?.appearance).toEqual(appearance);
    expect(current.pages[0]?.items[0]?.appearance).toEqual(DEFAULT_PROJECT_APPEARANCE);
  });

  it("preserves the cache identity when the Project is absent", () => {
    const current = projectWindow();
    expect(patchProjectAppearanceInWindow(
      current,
      "missing",
      DEFAULT_PROJECT_APPEARANCE,
    )).toBe(current);
  });

  it("serializes rapid changes and settles on the newest appearance", async () => {
    const first = deferred<Project>();
    const second = deferred<Project>();
    mocks.invoke
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const { hook, project, readAppearance } = setupHook();

    act(() => {
      hook.result.current.changeAppearance(RED_FOLDER);
      hook.result.current.changeAppearance(RED_HEART);
    });

    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(1));
    expect(mocks.invoke.mock.calls[0]).toEqual([
      "projects:update",
      project.id,
      { appearance: RED_FOLDER },
    ]);

    await act(async () => {
      first.resolve({
        ...project,
        appearance: RED_FOLDER,
        bindingRevision: 2,
      });
      await first.promise;
    });
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(2));
    expect(mocks.invoke.mock.calls[1]).toEqual([
      "projects:update",
      project.id,
      { appearance: RED_HEART },
    ]);

    await act(async () => {
      second.resolve({
        ...project,
        appearance: RED_HEART,
        bindingRevision: 3,
      });
      await second.promise;
    });
    await waitFor(() => expect(readAppearance()).toEqual(RED_HEART));
  });

  it("rolls a double failure back to the last confirmed appearance", async () => {
    const first = deferred<Project>();
    const second = deferred<Project>();
    mocks.invoke
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const { hook, readAppearance } = setupHook();

    act(() => {
      hook.result.current.changeAppearance(RED_FOLDER);
      hook.result.current.changeAppearance(RED_HEART);
    });

    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(1));
    await act(async () => {
      first.reject(new Error("offline one"));
      await first.promise.catch(() => undefined);
    });
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(2));
    await act(async () => {
      second.reject(new Error("offline two"));
      await second.promise.catch(() => undefined);
    });

    await waitFor(() => {
      expect(readAppearance()).toEqual(DEFAULT_PROJECT_APPEARANCE);
    });
    expect(mocks.toastDanger).toHaveBeenCalledTimes(2);
  });

  it("rolls the latest failure back to the prior confirmed write", async () => {
    const first = deferred<Project>();
    const second = deferred<Project>();
    mocks.invoke
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const { hook, project, readAppearance } = setupHook();

    act(() => {
      hook.result.current.changeAppearance(RED_FOLDER);
      hook.result.current.changeAppearance(RED_HEART);
    });

    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(1));
    await act(async () => {
      first.resolve({
        ...project,
        appearance: RED_FOLDER,
        bindingRevision: 2,
      });
      await first.promise;
    });
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(2));
    await act(async () => {
      second.reject(new Error("second failed"));
      await second.promise.catch(() => undefined);
    });

    await waitFor(() => expect(readAppearance()).toEqual(RED_FOLDER));
  });

  it("waits for the whole rapid queue and returns the newest confirmed revision", async () => {
    const first = deferred<Project>();
    const second = deferred<Project>();
    mocks.invoke
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const { hook, project } = setupHook();

    act(() => {
      hook.result.current.changeAppearance(RED_FOLDER);
      hook.result.current.changeAppearance(RED_HEART);
    });
    let settled = false;
    const waiting = hook.result.current.waitForSettledProject().then((value) => {
      settled = true;
      return value;
    });

    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(1));
    await act(async () => {
      first.resolve({
        ...project,
        appearance: RED_FOLDER,
        bindingRevision: 2,
      });
      await first.promise;
    });
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(2));
    expect(settled).toBe(false);

    let settledProject!: Project;
    await act(async () => {
      second.resolve({
        ...project,
        appearance: RED_HEART,
        bindingRevision: 3,
      });
      await second.promise;
      settledProject = await waiting;
    });
    expect(settledProject.bindingRevision).toBe(3);
    expect(settledProject.appearance).toEqual(RED_HEART);
  });

  it("returns the latest externally refreshed Project when no write is pending", async () => {
    const { hook, project } = setupHook();
    const refreshed = {
      ...project,
      name: "Nodex refreshed",
      bindingRevision: 7,
    };

    await act(async () => {
      hook.rerender({ currentProject: refreshed });
      await Promise.resolve();
    });

    await expect(
      hook.result.current.waitForSettledProject(),
    ).resolves.toMatchObject({
      name: "Nodex refreshed",
      bindingRevision: 7,
    });
  });
});
