import { fireEvent } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { act } from "react";
import { render } from "../../test/dom";
import {
  RelationPropertyEditor,
  readRelationValuePreview,
} from "./relation-property-editor";

const relationValue = {
  kind: "relation",
  value: {
    value_revision: 4,
    total_count: 2,
    targets: [
      {
        kind: "visible",
        page_id: "page-visible",
        title: "Visible task",
        lifecycle: "active",
        membership_state: "active_in_target_source",
      },
    ],
    restricted_count: 1,
    has_more: true,
  },
};

describe("RelationPropertyEditor", () => {
  test("projects bounded visible and restricted targets without inventing identities", () => {
    expect(readRelationValuePreview(relationValue)).toEqual({
      valueRevision: 4,
      totalCount: 2,
      targets: [
        {
          kind: "visible",
          pageId: "page-visible",
          title: "Visible task",
          lifecycle: "active",
          membershipState: "active_in_target_source",
        },
      ],
      restrictedCount: 1,
      hasMore: true,
    });
    expect(readRelationValuePreview({
      kind: "relation",
      value: { ...relationValue.value, targets: [{ kind: "restricted", page_id: "leak" }] },
    })?.targets).toEqual([{ kind: "restricted" }]);
  });

  test("emits patch-set intent for visible removal and candidate addition", async () => {
    const onPatch = vi.fn();
    const view = render(
      <RelationPropertyEditor
        label="Blocked by"
        value={relationValue}
        candidates={[
          { pageId: "page-visible", title: "Visible task" },
          { pageId: "page-candidate", title: "Candidate task" },
        ]}
        disabled={false}
        targetMatchesCurrentSource
        onPatch={onPatch}
        onClear={vi.fn()}
      />,
    );

    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Visible task ×" }));
      fireEvent.change(view.getByRole("combobox", { name: "Add Blocked by relation" }), {
        target: { value: "page-candidate" },
      });
      await Promise.resolve();
    });

    expect(onPatch).toHaveBeenNthCalledWith(1, {
      addPageIds: [],
      removePageIds: ["page-visible"],
    });
    expect(onPatch).toHaveBeenNthCalledWith(2, {
      addPageIds: ["page-candidate"],
      removePageIds: [],
    });
    expect(view.getByText("1 restricted")).toBeTruthy();
  });

  test("requires explicit confirmation before clearing restricted targets", async () => {
    const onClear = vi.fn();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    try {
      const view = render(
        <RelationPropertyEditor
          label="Blocked by"
          value={relationValue}
          candidates={[]}
          disabled={false}
          targetMatchesCurrentSource
          onPatch={vi.fn()}
          onClear={onClear}
        />,
      );

      await act(async () => {
        fireEvent.click(view.getByRole("button", { name: "Clear all" }));
        await Promise.resolve();
      });

      expect(confirm).toHaveBeenCalledWith(
        "Clear all 2 Blocked by relations, including targets not shown here?",
      );
      expect(onClear).toHaveBeenCalledOnce();
    } finally {
      confirm.mockRestore();
    }
  });

  test("drops stale continuation results when the value revision changes", async () => {
    let resolveLoad: ((value: {
      readonly targets: readonly [{
        readonly kind: "visible";
        readonly pageId: string;
        readonly title: string;
        readonly lifecycle: string;
        readonly membershipState: string;
      }];
      readonly nextCursor: null;
    }) => void) | undefined;
    const onLoadMore = vi.fn(() => new Promise<{
      readonly targets: readonly [{
        readonly kind: "visible";
        readonly pageId: string;
        readonly title: string;
        readonly lifecycle: string;
        readonly membershipState: string;
      }];
      readonly nextCursor: null;
    }>((resolve) => {
      resolveLoad = resolve;
    }));
    const props = {
      label: "Blocked by",
      candidates: [],
      disabled: false,
      targetMatchesCurrentSource: true,
      onPatch: vi.fn(),
      onClear: vi.fn(),
      onLoadMore,
    } as const;
    const view = render(<RelationPropertyEditor {...props} value={relationValue} />);

    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "+1 more" }));
      await Promise.resolve();
    });
    view.rerender(<RelationPropertyEditor
      {...props}
      value={{
        kind: "relation",
        value: {
          value_revision: 5,
          total_count: 0,
          targets: [],
          restricted_count: 0,
          has_more: false,
        },
      }}
    />);
    await act(async () => {
      resolveLoad?.({
        targets: [{
          kind: "visible",
          pageId: "page-stale",
          title: "Stale target",
          lifecycle: "active",
          membershipState: "active_in_target_source",
        }],
        nextCursor: null,
      });
      await Promise.resolve();
    });

    expect(view.queryByText("Stale target ×")).toBeNull();
  });
});
