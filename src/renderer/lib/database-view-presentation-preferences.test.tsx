import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

const testState = vi.hoisted(() => ({
  readDatabaseModule: vi.fn(),
  applyDatabaseModule: vi.fn(),
}));

vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  readDatabaseModule: testState.readDatabaseModule,
  applyDatabaseModule: testState.applyDatabaseModule,
}));

import {
  resetDatabaseViewPresentationPreferencesForTests,
  useDatabaseViewPresentationPreference,
} from "./database-view-presentation-preferences";

const deferred = <Value,>() => {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((next) => {
    resolve = next;
  });
  return { promise, resolve };
};

const viewId = "0198a4f1-b850-7000-8000-000000000001";

describe("useDatabaseViewPresentationPreference", () => {
  beforeEach(() => {
    resetDatabaseViewPresentationPreferencesForTests();
    window.localStorage.clear();
    testState.readDatabaseModule.mockReset();
    testState.applyDatabaseModule.mockReset().mockResolvedValue({
      ok: true,
      value: {
        committedRevisions: {
          [`view_preferences:profile:${viewId}`]: 5,
        },
      },
      localCommit: { status: "applied" },
    });
  });

  test("serializes an optimistic collapse behind preference hydration", async () => {
    const read = deferred<{
      readonly ok: true;
      readonly value: {
        readonly storeEpoch: string;
        readonly value: {
          readonly kind: "view_personal_preferences";
          readonly value: {
            readonly presentationOverride: Record<string, never>;
            readonly collapsedGroupKeys: readonly string[];
            readonly revision: number;
          };
        };
      };
    }>();
    testState.readDatabaseModule.mockReturnValue(read.promise);
    const { result } = renderHook(() =>
      useDatabaseViewPresentationPreference("project-test", viewId));

    await waitFor(() => expect(testState.readDatabaseModule).toHaveBeenCalledOnce());
    let collapseResult: Promise<boolean> | undefined;
    act(() => {
      collapseResult = result.current.setCollapsedGroupKeys(["group:local"]);
    });

    expect(result.current.collapsedGroupKeys).toEqual(["group:local"]);
    expect(testState.applyDatabaseModule).not.toHaveBeenCalled();

    await act(async () => {
      read.resolve({
        ok: true,
        value: {
          storeEpoch: "epoch-loaded",
          value: {
            kind: "view_personal_preferences",
            value: {
              presentationOverride: {},
              collapsedGroupKeys: ["group:server"],
              revision: 4,
            },
          },
        },
      });
      await collapseResult;
    });

    expect(collapseResult).toBeDefined();
    expect(await collapseResult).toBe(true);
    expect(testState.applyDatabaseModule).toHaveBeenCalledWith(
      "project-test",
      expect.objectContaining({
        storeEpoch: "epoch-loaded",
        operations: [{
          kind: "put_view_personal_preferences",
          viewId,
          expectedRevision: 4,
          presentationOverride: {},
          collapsedGroupKeys: ["group:local"],
        }],
      }),
    );
    expect(result.current.collapsedGroupKeys).toEqual(["group:local"]);
    expect(result.current.revision).toBe(5);
  });

  test("retains one hydrated View preference across surface remounts", async () => {
    testState.readDatabaseModule.mockResolvedValue({
      ok: true,
      value: {
        storeEpoch: "epoch-loaded",
        value: {
          kind: "view_personal_preferences",
          value: {
            presentationOverride: { layout: "list" },
            collapsedGroupKeys: ["group:build"],
            revision: 4,
          },
        },
      },
    });
    const first = renderHook(() =>
      useDatabaseViewPresentationPreference("project-test", viewId));
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    first.unmount();

    const second = renderHook(() =>
      useDatabaseViewPresentationPreference("project-test", viewId));

    expect(second.result.current).toMatchObject({
      presentationOverride: { layout: "list" },
      collapsedGroupKeys: ["group:build"],
      revision: 4,
      loading: false,
      error: null,
    });
    expect(testState.readDatabaseModule).toHaveBeenCalledOnce();
  });

  test("retains presentation while rehydrating an independent Store epoch", async () => {
    const epochTwo = deferred<{
      readonly ok: true;
      readonly value: {
        readonly storeEpoch: string;
        readonly value: {
          readonly kind: "view_personal_preferences";
          readonly value: {
            readonly presentationOverride: { readonly layout: "board" };
            readonly collapsedGroupKeys: readonly string[];
            readonly revision: number;
          };
        };
      };
    }>();
    testState.readDatabaseModule
      .mockResolvedValueOnce({
        ok: true,
        value: {
          storeEpoch: "epoch-one",
          value: {
            kind: "view_personal_preferences",
            value: {
              presentationOverride: { layout: "list" },
              collapsedGroupKeys: [],
              revision: 4,
            },
          },
        },
      })
      .mockReturnValueOnce(epochTwo.promise);
    const { result } = renderHook(() =>
      useDatabaseViewPresentationPreference("project-test", viewId));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.synchronizeStoreEpoch("epoch-two"));

    expect(result.current).toMatchObject({
      presentationOverride: { layout: "list" },
      loading: true,
      saving: false,
    });

    await act(async () => {
      epochTwo.resolve({
        ok: true,
        value: {
          storeEpoch: "epoch-two",
          value: {
            kind: "view_personal_preferences",
            value: {
              presentationOverride: { layout: "board" },
              collapsedGroupKeys: [],
              revision: 1,
            },
          },
        },
      });
      await epochTwo.promise;
    });

    expect(result.current).toMatchObject({
      presentationOverride: { layout: "board" },
      revision: 1,
      loading: false,
    });
  });

  test("settles a crossed Store epoch without a rehydration loop", async () => {
    testState.readDatabaseModule
      .mockResolvedValueOnce({
        ok: true,
        value: {
          storeEpoch: "epoch-one",
          value: {
            kind: "view_personal_preferences",
            value: {
              presentationOverride: { layout: "list" },
              collapsedGroupKeys: [],
              revision: 4,
            },
          },
        },
      })
      .mockResolvedValue({
        ok: true,
        value: {
          storeEpoch: "epoch-stale",
          value: {
            kind: "view_personal_preferences",
            value: {
              presentationOverride: { layout: "board" },
              collapsedGroupKeys: [],
              revision: 1,
            },
          },
        },
      });
    const { result } = renderHook(() =>
      useDatabaseViewPresentationPreference("project-test", viewId));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.synchronizeStoreEpoch("epoch-two"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current).toMatchObject({
      presentationOverride: { layout: "list" },
      error: "Database View preference read crossed a Store epoch",
    });
    act(() => result.current.synchronizeStoreEpoch("epoch-two"));
    expect(testState.readDatabaseModule).toHaveBeenCalledTimes(2);

    act(() => result.current.synchronizeStoreEpoch("epoch-stale"));
    await waitFor(() => expect(result.current.error).toBeNull());
    expect(result.current).toMatchObject({
      presentationOverride: { layout: "board" },
      revision: 1,
      loading: false,
    });
    expect(testState.readDatabaseModule).toHaveBeenCalledTimes(3);
  });
});
