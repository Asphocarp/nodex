import { fireEvent } from "@testing-library/react";
import { act, useState } from "react";
import { expect, test } from "vite-plus/test";

import type { EffectiveDatabaseViewPresentation } from "../../../shared/database-kernel";
import { render } from "../../test/dom";
import { DatabaseViewSort } from "./database-view-sort";

const initial: EffectiveDatabaseViewPresentation = {
  layout: "list",
  presentation: {
    sort: [{ field: { kind: "manual" }, direction: "asc", nulls: "last" }],
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

test("edits ordered sort rules through accessible menu controls", async () => {
  function Harness() {
    const [effective, setEffective] = useState(initial);
    return <DatabaseViewSort effective={effective} properties={[]} onChange={setEffective} />;
  }

  const screen = render(<Harness />);
  await act(async () => {
    fireEvent.click(screen.getByLabelText("Sort View"));
    await Promise.resolve();
  });
  fireEvent.click(screen.getByRole("button", { name: "Sort" }));

  expect(screen.getByLabelText("Sort field 2")).toBeTruthy();
  expect(screen.getByLabelText("Sort direction 2").getAttribute("aria-haspopup")).toBe("menu");

  fireEvent.click(screen.getByLabelText("Remove sort 1"));
  expect(screen.queryByLabelText("Sort field 2")).toBeNull();
  expect(screen.getByLabelText("Sort field 1")).toBeTruthy();
});
