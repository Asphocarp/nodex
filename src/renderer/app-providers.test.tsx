import { useLayoutEffect } from "react";
import { render } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { TestQueryProvider } from "@/test/query";
import { useMaitaiStore, type MaitaiStore } from "./lib/maitai";
import { RendererStateProvider } from "./app-providers";

describe("renderer state provider", () => {
  test("keeps one Maitai store across parent rerenders", () => {
    const stores: MaitaiStore[] = [];
    function Probe({ value }: { value: string }) {
      const store = useMaitaiStore();
      useLayoutEffect(() => {
        stores.push(store);
      }, [store, value]);
      return <span>{value}</span>;
    }
    const renderTree = (value: string) => (
      <TestQueryProvider>
        <RendererStateProvider>
          <Probe value={value} />
        </RendererStateProvider>
      </TestQueryProvider>
    );
    const view = render(renderTree("one"));
    view.rerender(renderTree("two"));

    expect(stores).toHaveLength(2);
    expect(stores[0]).toBe(stores[1]);
  });
});
