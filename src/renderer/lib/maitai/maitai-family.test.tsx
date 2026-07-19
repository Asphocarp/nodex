import { useLayoutEffect } from "react";
import { render } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import {
  MaitaiProvider,
  ScopeProvider,
  appScope,
  atomWithExternalStore,
  createMaitaiStore,
  defineScope,
  getMaitaiDebugSnapshot,
  scopedAtom,
  scopedAtomFamily,
  useScopeHandle,
  useScopedAtomValue,
  type ScopeHandle,
} from "./index";

const threadScope = defineScope({
  debugLabel: "FamilyThreadScope",
  parent: appScope,
  retain: { max: 20 },
  getKey: (value: string) => value,
});

const family = scopedAtomFamily({
  scope: threadScope,
  debugLabel: "turn-collapse",
  create: () => scopedAtom(threadScope, false, { debugLabel: "collapsed" }),
});

const excludedFamily = scopedAtomFamily({
  scope: threadScope,
  debugLabel: "excluded-field",
  excludeFieldsFromKey: ["debug"] as const,
  create: ({ id }: { id: string; debug: string }) =>
    scopedAtom(threadScope, 0, { debugLabel: `value:${id}` }),
});

const appConversationFamily = scopedAtomFamily({
  scope: appScope,
  debugLabel: "app-conversation",
  key: (conversationId: string) => conversationId,
  create: () => scopedAtom(appScope, 0, { debugLabel: "value" }),
});

function HandleProbe({ onHandle }: { onHandle(handle: ScopeHandle): void }) {
  const handle = useScopeHandle(threadScope);
  useLayoutEffect(() => onHandle(handle), [handle, onHandle]);
  return null;
}

describe("Maitai scoped atom families", () => {
  test("normalizes plain-object key order and removes explicit entries", () => {
    const store = createMaitaiStore();
    const handleRef: { current: ScopeHandle | null } = { current: null };
    render(
      <MaitaiProvider store={store}>
        <ScopeProvider scope={threadScope} descriptor="thread-a">
          <HandleProbe onHandle={(handle) => {
            handleRef.current = handle;
          }} />
        </ScopeProvider>
      </MaitaiProvider>,
    );
    const handle = handleRef.current;
    if (!handle) throw new Error("Expected scope handle");

    const first = family({ conversationId: "c", turnKey: "t" });
    const reordered = family({ turnKey: "t", conversationId: "c" });
    expect(first).toBe(reordered);
    handle.set(first, true);
    expect(handle.get(reordered)).toBe(true);
    expect(getMaitaiDebugSnapshot(store).find((entry) => entry.definitionLabel === "FamilyThreadScope")?.familyEntryCount)
      .toBe(1);
    expect(family.remove(handle, { conversationId: "c", turnKey: "t" })).toBe(true);
    expect(family.remove(handle, { conversationId: "c", turnKey: "t" })).toBe(false);
    expect(family(["conversation", { turn: 1, part: 2 }])).toBe(
      family(["conversation", { part: 2, turn: 1 }]),
    );
  });

  test("excluded fields do not affect family identity while nonplain objects use identity", () => {
    const store = createMaitaiStore();
    const handleRef: { current: ScopeHandle | null } = { current: null };
    render(
      <MaitaiProvider store={store}>
        <ScopeProvider scope={threadScope} descriptor="thread-a">
          <HandleProbe onHandle={(handle) => {
            handleRef.current = handle;
          }} />
        </ScopeProvider>
      </MaitaiProvider>,
    );
    const handle = handleRef.current;
    if (!handle) throw new Error("Expected scope handle");

    expect(excludedFamily({ id: "a", debug: "one" })).toBe(
      excludedFamily({ id: "a", debug: "two" }),
    );
    const firstObject = new Date(0);
    const secondObject = new Date(0);
    expect(family(firstObject)).not.toBe(family(secondObject));
    expect(handle.resolve(family(firstObject))).not.toBe(handle.resolve(family(secondObject)));
  });

  test("app-scoped family removes an explicit conversation key", () => {
    const store = createMaitaiStore();
    const handleRef: { current: ScopeHandle | null } = { current: null };
    render(
      <MaitaiProvider store={store}>
        <HandleProbeForScope scope={appScope} onHandle={(handle) => {
          handleRef.current = handle;
        }} />
      </MaitaiProvider>,
    );
    const handle = handleRef.current;
    if (!handle) throw new Error("Expected app scope handle");
    const member = appConversationFamily("conversation-1");
    handle.set(member, 4);
    expect(handle.get(member)).toBe(4);
    expect(appConversationFamily.remove(handle, "conversation-1")).toBe(true);
    expect(handle.get(appConversationFamily("conversation-1"))).toBe(0);
  });

  test("family-removal-releases-external-subscription", () => {
    let unsubscribeCount = 0;
    const externalFamily = scopedAtomFamily({
      scope: threadScope,
      debugLabel: "external-family",
      create: () => atomWithExternalStore(threadScope, {
        debugLabel: "external",
        getSnapshot: () => 1,
        subscribe: () => () => {
          unsubscribeCount += 1;
        },
      }),
    });
    const member = externalFamily("conversation-1");
    const store = createMaitaiStore();
    const handleRef: { current: ScopeHandle | null } = { current: null };
    function ExternalProbe() {
      const handle = useScopeHandle(threadScope);
      useLayoutEffect(() => {
        handleRef.current = handle;
      }, [handle]);
      return <output>{useScopedAtomValue(member)}</output>;
    }
    const view = render(
      <MaitaiProvider store={store}>
        <ScopeProvider scope={threadScope} descriptor="thread-a">
          <ExternalProbe />
        </ScopeProvider>
      </MaitaiProvider>,
    );
    expect(view.getByText("1")).toBeTruthy();
    view.unmount();
    expect(unsubscribeCount).toBe(1);
    const handle = handleRef.current;
    if (!handle) throw new Error("Expected scope handle");
    expect(externalFamily.remove(handle, "conversation-1")).toBe(true);
  });
});

function HandleProbeForScope({
  scope,
  onHandle,
}: {
  scope: typeof appScope;
  onHandle(handle: ScopeHandle): void;
}) {
  const handle = useScopeHandle(scope);
  useLayoutEffect(() => onHandle(handle), [handle, onHandle]);
  return null;
}
