import { describe, expect, test } from "bun:test";
import { act } from "@testing-library/react";
import { createElement, useMemo } from "react";
import { render, settleAsyncRender } from "../../test/dom";
import {
  ContentSearchProvider,
  useContentSearch,
  useRegisterContentSearchSource,
  type ContentSearchController,
  type ContentSearchLocalSource,
} from "./content-search-context";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

describe("ContentSearchProvider", () => {
  test("aborts the previous local ensureVisible before activating the next match", async () => {
    const ensureSignals: AbortSignal[] = [];
    const activatedIds: string[] = [];
    let controller: ContentSearchController | null = null;

    function Probe() {
      controller = useContentSearch();
      const source = useMemo<ContentSearchLocalSource>(() => ({
        domain: "conversation",
        contextId: "conversation:thread",
        search: (query) => ({
          query,
          totalMatches: 2,
          capped: false,
          matches: [
            {
              id: "match-1",
              domain: "conversation",
              contextId: "conversation:thread",
              ordinal: 0,
              label: "needle one",
              meta: {},
            },
            {
              id: "match-2",
              domain: "conversation",
              contextId: "conversation:thread",
              ordinal: 1,
              label: "needle two",
              meta: {},
            },
          ],
        }),
        ensureVisible: (_match, { signal }) => {
          ensureSignals.push(signal);
          if (ensureSignals.length > 1) return;
          return new Promise<void>((resolve) => {
            signal.addEventListener("abort", () => resolve(), { once: true });
          });
        },
        activate: (match) => {
          activatedIds.push(match.id);
        },
        clear: () => {},
      }), []);
      useRegisterContentSearchSource(source);
      return createElement("div");
    }

    render(createElement(ContentSearchProvider, null, createElement(Probe)));
    await settleAsyncRender();

    if (!controller) throw new Error("Expected content search controller");
    await act(async () => {
      controller?.requestOpen({ preferredDomain: "conversation" });
      controller?.setQuery("needle");
    });
    await settleAsyncRender();
    await act(async () => {
      await sleep(220);
      await settleAsyncRender();
    });

    expect(ensureSignals.length).toBe(1);
    expect(activatedIds.length).toBe(0);

    await act(async () => {
      controller?.goNext();
      await settleAsyncRender();
    });

    expect(ensureSignals[0]?.aborted ?? false).toBeTrue();
    expect(ensureSignals.length).toBe(2);
    expect(activatedIds[0] ?? "").toBe("match-2");
  });

  test("does not activate stale local results after the query changes", async () => {
    const oldSearch = createDeferred<Awaited<ReturnType<ContentSearchLocalSource["search"]>>>();
    const activatedQueries: string[] = [];
    let controller: ContentSearchController | null = null;

    function Probe() {
      controller = useContentSearch();
      const source = useMemo<ContentSearchLocalSource>(() => ({
        domain: "conversation",
        contextId: "conversation:thread",
        search: (query) => query === "old"
          ? oldSearch.promise
          : {
            query,
            totalMatches: 0,
            capped: false,
            matches: [],
          },
        activate: (_match, query) => {
          activatedQueries.push(query);
        },
        clear: () => {},
      }), []);
      useRegisterContentSearchSource(source);
      return createElement("div");
    }

    render(createElement(ContentSearchProvider, null, createElement(Probe)));
    await settleAsyncRender();

    if (!controller) throw new Error("Expected content search controller");
    await act(async () => {
      controller?.requestOpen({ preferredDomain: "conversation" });
      controller?.setQuery("old");
    });
    await act(async () => {
      await sleep(220);
      await settleAsyncRender();
    });
    await act(async () => {
      controller?.setQuery("new");
      oldSearch.resolve({
        query: "old",
        totalMatches: 1,
        capped: false,
        matches: [{
          id: "old-match",
          domain: "conversation",
          contextId: "conversation:thread",
          ordinal: 0,
          label: "old",
          meta: {},
        }],
      });
      await settleAsyncRender();
    });

    expect(activatedQueries.length).toBe(0);
  });
});
