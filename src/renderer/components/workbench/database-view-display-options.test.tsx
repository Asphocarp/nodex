import { fireEvent } from "@testing-library/react";
import { act, useState } from "react";
import { describe, expect, test, vi } from "vitest";

import type { EffectiveDatabaseViewPresentation } from "../../../shared/database-kernel";
import type { DataSourcePropertyRecordV2 } from "../../../shared/database-module-v2";
import {
  parseDataSourceId,
  parseDataSourcePropertyId,
} from "../../../shared/database-identities";
import { testPropertySemantics } from "../../../shared/testing/database-property-record";
import { render } from "../../test/dom";
import { DatabaseViewDisplayOptions } from "./database-view-display-options";

const timestamp = "2026-08-11T00:00:00.000Z";
const durable: EffectiveDatabaseViewPresentation = {
  layout: "board",
  presentation: {
    sort: [{ field: { kind: "manual" }, direction: "asc", nulls: "last" }],
    group: { propertyId: "status" },
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
const properties: readonly DataSourcePropertyRecordV2[] = [{
  propertyId: parseDataSourcePropertyId("status"),
  dataSourceId: parseDataSourceId("source:display-options"),
  name: "Status",
  ...testPropertySemantics("select", 2),
  valueType: "select",
  config: { options: [{ id: "build", name: "Build" }, { id: "ship", name: "Ship" }] },
  rankKey: "a",
  lifecycle: "active",
  revision: 1,
  createdAt: timestamp,
  updatedAt: timestamp,
}];

test("keeps layout edits personal until explicitly published or reset", async () => {
  const publish = vi.fn();
  function Harness() {
    const [effective, setEffective] = useState(durable);
    return (
      <DatabaseViewDisplayOptions
        durable={durable}
        effective={effective}
        properties={properties}
        onChange={setEffective}
        onReset={() => setEffective(durable)}
        onPublish={publish}
      />
    );
  }

  const screen = render(<Harness />);
  await act(async () => {
    fireEvent.click(screen.getByLabelText("Display options"));
    await Promise.resolve();
  });
  const groupOrdering = screen.getByRole("button", { name: "Group ordering" });
  expect(groupOrdering.getAttribute("aria-pressed")).toBe("false");
  fireEvent.click(groupOrdering);
  expect(groupOrdering.getAttribute("aria-pressed")).toBe("true");
  const boardIdField = screen.getByRole("button", { name: "ID" });
  expect(boardIdField.getAttribute("aria-pressed")).toBe("false");
  fireEvent.click(boardIdField);
  expect(boardIdField.getAttribute("aria-pressed")).toBe("true");
  expect(screen.queryByRole("button", { name: "Internal ID" })).toBeNull();
  fireEvent.click(screen.getByRole("tab", { name: "List" }));
  const statusField = screen.getByRole("button", { name: "Status" });
  expect(statusField.getAttribute("aria-pressed")).toBe("false");
  fireEvent.click(statusField);
  expect(statusField.getAttribute("aria-pressed")).toBe("true");
  const idField = screen.getByRole("button", { name: "ID" });
  expect(idField.hasAttribute("disabled")).toBe(false);
  expect(idField.getAttribute("aria-pressed")).toBe("false");
  fireEvent.click(idField);
  expect(idField.getAttribute("aria-pressed")).toBe("true");
  expect(screen.queryByRole("button", { name: "Internal ID" })).toBeNull();

  expect(screen.getByRole("button", { name: "Reset" }).hasAttribute("disabled"))
    .toBe(false);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Set default for everyone" }));
    await Promise.resolve();
  });
  expect(publish).toHaveBeenCalledTimes(1);

  fireEvent.click(screen.getByRole("button", { name: "Reset" }));
  expect(screen.getByRole("tab", { name: "Board" }).getAttribute("aria-selected"))
    .toBe("true");
});

describe("DatabaseViewDisplayOptions", () => {
  test("exposes capability-backed grouping, completion, and fields", async () => {
    const onForcedFieldChange = vi.fn();
    const screen = render(
      <DatabaseViewDisplayOptions
        durable={durable}
        effective={durable}
        properties={properties}
        onChange={() => undefined}
        onReset={() => undefined}
        onPublish={() => undefined}
        onForcedFieldChange={onForcedFieldChange}
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Display options"));
      await Promise.resolve();
    });
    expect(screen.getByLabelText("Group by")).toBeTruthy();
    expect(screen.getByLabelText("Completed Page range")).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Show sub-pages" })).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Nested sub-pages" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Status" }).getAttribute("aria-pressed"))
      .toBe("false");
    expect(screen.getByRole("switch", { name: "Show empty groups" })).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Order by"));
      await Promise.resolve();
    });
    const orderingSearch = screen.getByRole("combobox", { name: "Search Order by" });
    await act(async () => {
      fireEvent.change(orderingSearch, { target: { value: "status" } });
      await Promise.resolve();
    });
    fireEvent.click(screen.getByRole("option", { name: "Status" }));
    expect(onForcedFieldChange).toHaveBeenLastCalledWith({
      kind: "property",
      propertyId: "status",
    });
    fireEvent.click(screen.getByLabelText("Display options"));
    expect(onForcedFieldChange).toHaveBeenLastCalledWith(null);
  });
});
