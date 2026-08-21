import { fireEvent } from "@testing-library/react";
import { expect, test, vi } from "vite-plus/test";

import type { EffectiveDatabaseViewPresentation } from "../../../shared/database-kernel";
import { render } from "../../test/dom";
import { DatabaseViewRulesSummaryRow } from "./database-view-rules-summary-row";

const effective: EffectiveDatabaseViewPresentation = {
  layout: "list",
  presentation: {
    sort: [{ field: { kind: "created" }, direction: "desc", nulls: "last" }],
    group: null,
    subgroup: null,
    groupDirection: "asc",
    completion: { range: "all", orderByRecency: false },
    hierarchy: { showSubPages: true, nestedSubPages: false },
    layouts: {
      board: { fields: [], showEmptyGroups: false },
      list: { fields: [], showEmptyGroups: false },
    },
  },
};

test("restores the active Filter and Sort summary actions below the toolbar", () => {
  const onOpenFilter = vi.fn();
  const onOpenSort = vi.fn();
  const screen = render(
    <DatabaseViewRulesSummaryRow
      filter={{
        kind: "clause",
        propertyId: "status",
        operator: "equals",
        value: "build",
      }}
      effective={effective}
      properties={[]}
      onOpenFilter={onOpenFilter}
      onOpenSort={onOpenSort}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: /Created/ }));
  fireEvent.click(screen.getByRole("button", { name: /Missing property/ }));

  expect(onOpenSort).toHaveBeenCalledOnce();
  expect(onOpenFilter).toHaveBeenCalledOnce();
});
