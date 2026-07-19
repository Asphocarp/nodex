import { Component, Fragment, useLayoutEffect, type ReactNode } from "react";
import { act, fireEvent, render } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, test, vi } from "vitest";
import {
  MaitaiProvider,
  ScopeProvider,
  appScope,
  createMaitaiStore,
  defineScope,
  disposeMaitaiStore,
  getMaitaiDebugSnapshot,
  registerScopeDisposerForTests,
  scopedAtom,
  scopedDerivedAtom,
  scopedWritableAtom,
  useScopeHandle,
  useScopedAtomValue,
  useSetScopedAtom,
  type ScopeHandle,
} from "./index";

class ErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {}
  render() {
    return this.state.failed ? <span>failed</span> : this.props.children;
  }
}

function ThrowDuringRender(): never {
  throw new Error("abandoned");
}

describe("Maitai kernel conformance vectors", () => {
  test("primitive-derived-writable-and-write-only-bind-through-the-scope-chain", () => {
    const parentScope = defineScope({
      debugLabel: "OperationParent",
      parent: appScope,
      retain: { max: 2 },
      getKey: (value: string) => value,
    });
    const childScope = defineScope({
      debugLabel: "OperationChild",
      parent: parentScope,
      retain: { max: 2 },
      getKey: (value: string) => value,
    });
    const count = scopedAtom(parentScope, 1, { debugLabel: "count" });
    const doubled = scopedDerivedAtom(parentScope, (get) => get(count) * 2, {
      debugLabel: "doubled",
    });
    const add = scopedWritableAtom(
      parentScope,
      (get) => get(doubled),
      (get, set, amount: number) => set(count, get(count) + amount),
      { debugLabel: "add" },
    );
    const replace = scopedWritableAtom(
      parentScope,
      () => null,
      (_get, set, value: number) => set(count, value),
      { debugLabel: "replace" },
    );
    const handleRef: { current: ScopeHandle | null } = { current: null };
    function Probe() {
      const handle = useScopeHandle(childScope);
      const value = useScopedAtomValue(doubled);
      const addValue = useSetScopedAtom(add);
      const replaceValue = useSetScopedAtom(replace);
      useLayoutEffect(() => {
        handleRef.current = handle;
      }, [handle]);
      return (
        <>
          <output>{value}</output>
          <button type="button" onClick={() => addValue(2)}>add</button>
          <button type="button" onClick={() => replaceValue(9)}>replace</button>
        </>
      );
    }
    const store = createMaitaiStore();
    const view = render(
      <MaitaiProvider store={store}>
        <ScopeProvider scope={parentScope} descriptor="parent">
          <ScopeProvider scope={childScope} descriptor="child">
            <Probe />
          </ScopeProvider>
        </ScopeProvider>
      </MaitaiProvider>,
    );
    const handle = handleRef.current;
    if (!handle) throw new Error("Expected child handle");
    expect(handle.resolve(count)).toBe(handle.resolve(count));
    expect(view.getByText("2")).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "add" }));
    expect(view.getByText("6")).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "replace" }));
    expect(view.getByText("18")).toBeTruthy();

    let notifications = 0;
    const unsubscribe = handle.sub(count, () => {
      notifications += 1;
    });
    act(() => handle.set(count, 10));
    expect(handle.get(doubled)).toBe(20);
    expect(notifications).toBe(1);
    unsubscribe();
  });

  test("independently-created-renderer-stores-isolate-atom-values", () => {
    const valueAtom = scopedAtom(appScope, 0, { debugLabel: "isolated-value" });
    const handles: ScopeHandle[] = [];
    function Probe() {
      const handle = useScopeHandle(appScope);
      useLayoutEffect(() => {
        handles.push(handle);
      }, [handle]);
      return null;
    }
    const first = createMaitaiStore();
    const second = createMaitaiStore();
    render(<MaitaiProvider store={first}><Probe /></MaitaiProvider>);
    render(<MaitaiProvider store={second}><Probe /></MaitaiProvider>);
    handles[0]?.set(valueAtom, 7);
    expect(handles[0]?.get(valueAtom)).toBe(7);
    expect(handles[1]?.get(valueAtom)).toBe(0);
    expect(handles[0]?.resolve(valueAtom)).not.toBe(handles[1]?.resolve(valueAtom));
  });

  test("child-scopes-inherit-the-exact-renderer-query-client", () => {
    const scope = defineScope({
      debugLabel: "QueryScope",
      parent: appScope,
      retain: { max: 1 },
      getKey: (value: string) => value,
    });
    const queryClient = new QueryClient();
    const inheritedQueryClient = scopedDerivedAtom(
      scope,
      (get) => get.queryClient,
      { debugLabel: "query-client" },
    );
    function Probe() {
      return <output>{useScopedAtomValue(inheritedQueryClient) === queryClient ? "same" : "different"}</output>;
    }
    const store = createMaitaiStore({ queryClient });
    const view = render(
      <MaitaiProvider store={store}>
        <ScopeProvider scope={scope} descriptor="query"><Probe /></ScopeProvider>
      </MaitaiProvider>,
    );
    expect(view.getByText("same")).toBeTruthy();
  });

  test("abandoned-render-does-not-publish-provisional-node", () => {
    const scope = defineScope({
      debugLabel: "AbandonedScope",
      parent: appScope,
      retain: { max: 2 },
      getKey: (value: string) => value,
    });
    const store = createMaitaiStore();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(
      <MaitaiProvider store={store}>
        <ErrorBoundary>
          <ScopeProvider scope={scope} descriptor="never-committed">
            <ThrowDuringRender />
          </ScopeProvider>
        </ErrorBoundary>
      </MaitaiProvider>,
    );
    consoleError.mockRestore();
    expect(getMaitaiDebugSnapshot(store).map((entry) => entry.definitionLabel)).toEqual(["AppScope"]);
  });

  test("parent-descriptor-change-invalidates-child-merged-scope-read", () => {
    const parentScope = defineScope({
      debugLabel: "DescriptorParent",
      parent: appScope,
      retain: { max: 2 },
      getKey: (value: { id: string; label: string }) => value.id,
    });
    const childScope = defineScope({
      debugLabel: "DescriptorChild",
      parent: parentScope,
      retain: { max: 2 },
      getKey: (value: { route: string }) => value.route,
    });
    const mergedLabel = scopedDerivedAtom(
      childScope,
      (get) => {
        const scope = get.scope(childScope) as { label: string; route: string };
        return `${scope.label}:${scope.route}`;
      },
      { debugLabel: "merged-label" },
    );
    function Probe() {
      return <output>{useScopedAtomValue(mergedLabel)}</output>;
    }
    const store = createMaitaiStore();
    const tree = (label: string) => (
      <MaitaiProvider store={store}>
        <ScopeProvider scope={parentScope} descriptor={{ id: "a", label }}>
          <ScopeProvider scope={childScope} descriptor={{ route: "/thread" }}>
            <Probe />
          </ScopeProvider>
        </ScopeProvider>
      </MaitaiProvider>
    );
    const view = render(tree("Before"));
    expect(view.getByText("Before:/thread")).toBeTruthy();
    view.rerender(tree("After"));
    expect(view.getByText("After:/thread")).toBeTruthy();
    expect(getMaitaiDebugSnapshot(store).find((entry) => entry.definitionLabel === "DescriptorParent")?.contextVersion)
      .toBe(1);
  });

  test("abandoned-same-key-descriptor-change-leaves-committed-state-untouched", () => {
    const scope = defineScope({
      debugLabel: "AbandonedDescriptorScope",
      parent: appScope,
      retain: { max: 2 },
      getKey: (value: { id: string; label: string }) => value.id,
    });
    const label = scopedDerivedAtom(
      scope,
      (get) => (get.scope(scope) as { label: string }).label,
      { debugLabel: "label" },
    );
    const handleRef: { current: ScopeHandle | null } = { current: null };
    function Probe() {
      const handle = useScopeHandle(scope);
      useLayoutEffect(() => {
        handleRef.current = handle;
      }, [handle]);
      return null;
    }
    const store = createMaitaiStore();
    const committed = render(
      <MaitaiProvider store={store}>
        <ScopeProvider scope={scope} descriptor={{ id: "a", label: "Before" }}>
          <Probe />
        </ScopeProvider>
      </MaitaiProvider>,
    );
    committed.unmount();
    const handle = handleRef.current;
    if (!handle) throw new Error("Expected committed handle");
    expect(handle.get(label)).toBe("Before");

    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(
      <MaitaiProvider store={store}>
        <ErrorBoundary>
          <ScopeProvider scope={scope} descriptor={{ id: "a", label: "After" }}>
            <ThrowDuringRender />
          </ScopeProvider>
        </ErrorBoundary>
      </MaitaiProvider>,
    );
    consoleError.mockRestore();
    expect(handle.get(label)).toBe("Before");
    expect(getMaitaiDebugSnapshot(store).find((entry) => entry.definitionLabel === "AbandonedDescriptorScope")?.contextVersion)
      .toBe(0);
  });

  test("over-limit-all-mounted-defers-trim-and-lease-release-retries-trim", () => {
    const scope = defineScope({
      debugLabel: "MountedScope",
      parent: appScope,
      retain: { max: 2 },
      getKey: (value: string) => value,
    });
    const store = createMaitaiStore();
    const tree = (keys: readonly string[]) => (
      <MaitaiProvider store={store}>
        {keys.map((key) => (
          <ScopeProvider key={key} scope={scope} descriptor={key}>
            <Fragment />
          </ScopeProvider>
        ))}
      </MaitaiProvider>
    );
    const view = render(tree(["a", "b", "c"]));
    expect(getMaitaiDebugSnapshot(store).filter((entry) => entry.definitionLabel === "MountedScope"))
      .toHaveLength(3);
    expect(getMaitaiDebugSnapshot(store).filter((entry) => entry.definitionLabel === "MountedScope"))
      .toSatisfy((entries: Array<{ mountedCount: number }>) => entries.every((entry) => entry.mountedCount === 1));
    view.rerender(tree(["c"]));
    expect(getMaitaiDebugSnapshot(store).filter((entry) => entry.definitionLabel === "MountedScope"))
      .toHaveLength(2);
  });

  test("parent-eviction-recursively-disposes-children-once", () => {
    const parentScope = defineScope({
      debugLabel: "EvictedParent",
      parent: appScope,
      retain: { max: 1 },
      getKey: (value: string) => value,
    });
    const childScope = defineScope({
      debugLabel: "EvictedChild",
      parent: parentScope,
      retain: { max: 1 },
      getKey: (value: string) => value,
    });
    const valueAtom = scopedAtom(childScope, 1, { debugLabel: "value" });
    const childHandleRef: { current: ScopeHandle | null } = { current: null };
    function Probe() {
      const handle = useScopeHandle(childScope);
      useLayoutEffect(() => {
        childHandleRef.current = handle;
      }, [handle]);
      return null;
    }
    const store = createMaitaiStore();
    const tree = (key: string) => (
      <MaitaiProvider store={store}>
        <ScopeProvider scope={parentScope} descriptor={key}>
          <ScopeProvider scope={childScope} descriptor="route">
            <Probe />
          </ScopeProvider>
        </ScopeProvider>
      </MaitaiProvider>
    );
    const view = render(tree("a"));
    const firstHandle = childHandleRef.current;
    view.rerender(tree("b"));
    expect(() => firstHandle?.get(valueAtom)).toThrow(/disposed/i);
    expect(getMaitaiDebugSnapshot(store).filter((entry) => entry.definitionLabel === "EvictedChild"))
      .toHaveLength(1);
  });

  test("same-key-double-provider-is-rejected", () => {
    const scope = defineScope({
      debugLabel: "ExclusiveScope",
      parent: appScope,
      retain: { max: 2 },
      getKey: (value: string) => value,
    });
    const store = createMaitaiStore();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const view = render(
      <MaitaiProvider store={store}>
        <ErrorBoundary>
          <ScopeProvider scope={scope} descriptor="same"><Fragment /></ScopeProvider>
          <ScopeProvider scope={scope} descriptor="same"><Fragment /></ScopeProvider>
        </ErrorBoundary>
      </MaitaiProvider>,
    );
    consoleError.mockRestore();
    expect(view.getByText("failed")).toBeTruthy();
    expect(getMaitaiDebugSnapshot(store).filter((entry) => entry.definitionLabel === "ExclusiveScope"))
      .toHaveLength(1);
  });

  test("nested-maitai-provider-is-rejected", () => {
    const outer = createMaitaiStore();
    const inner = createMaitaiStore();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const view = render(
      <MaitaiProvider store={outer}>
        <ErrorBoundary>
          <MaitaiProvider store={inner}><Fragment /></MaitaiProvider>
        </ErrorBoundary>
      </MaitaiProvider>,
    );
    consoleError.mockRestore();
    expect(view.getByText("failed")).toBeTruthy();
  });

  test("disposal-aggregates-cleanup-errors-and-remains-final", () => {
    const scope = defineScope({
      debugLabel: "CleanupScope",
      parent: appScope,
      retain: { max: 1 },
      getKey: (value: string) => value,
    });
    const handleRef: { current: ScopeHandle | null } = { current: null };
    const cleanupLog: string[] = [];
    function Probe() {
      const handle = useScopeHandle(scope);
      useLayoutEffect(() => {
        handleRef.current = handle;
      }, [handle]);
      return null;
    }
    const store = createMaitaiStore();
    const tree = (key: string) => (
      <MaitaiProvider store={store}>
        <ScopeProvider scope={scope} descriptor={key}>
          <Probe />
        </ScopeProvider>
      </MaitaiProvider>
    );
    const view = render(tree("a"));
    const firstHandle = handleRef.current;
    if (!firstHandle) throw new Error("Expected handle");
    registerScopeDisposerForTests(firstHandle, () => {
      cleanupLog.push("first");
      throw new Error("cleanup failed");
    });
    registerScopeDisposerForTests(firstHandle, () => cleanupLog.push("second"));
    view.rerender(tree("b"));

    expect(cleanupLog).toEqual(["first", "second"]);
    expect(store.cleanupErrors).toHaveLength(1);
    expect(() => firstHandle.get(scopedAtom(scope, 0, { debugLabel: "late" }))).toThrow(/disposed/i);
  });

  test("renderer-shutdown-disposes-mounted-scope-resources-once", () => {
    const scope = defineScope({
      debugLabel: "ShutdownScope",
      parent: appScope,
      retain: { max: 1 },
      getKey: (value: string) => value,
    });
    const valueAtom = scopedAtom(scope, 0, { debugLabel: "value" });
    const handleRef: { current: ScopeHandle | null } = { current: null };
    const cleanup = vi.fn();
    function Probe() {
      const handle = useScopeHandle(scope);
      useLayoutEffect(() => {
        handleRef.current = handle;
        return registerScopeDisposerForTests(handle, cleanup);
      }, [handle]);
      return null;
    }
    const store = createMaitaiStore();
    const view = render(
      <MaitaiProvider store={store}>
        <ScopeProvider scope={scope} descriptor="mounted"><Probe /></ScopeProvider>
      </MaitaiProvider>,
    );
    disposeMaitaiStore(store);
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(() => handleRef.current?.get(valueAtom)).toThrow(/disposed/i);
    view.unmount();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });
});
