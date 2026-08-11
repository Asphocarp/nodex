import { describe, expect, test } from "vitest";

import type { DatabaseViewField } from "../../../../shared/database-kernel";
import {
  databaseListGridTemplate,
  partitionDatabaseListFields,
  withForcedDatabaseListField,
} from "./database-list-grid";

const fields: readonly DatabaseViewField[] = [
  { kind: "property", propertyId: "assignee" },
  { kind: "property", propertyId: "labels" },
  { kind: "intrinsic", field: "updated_at" },
];

describe("Database List field registry", () => {
  test("packs properties into the title cell and reserves grid tracks only for timestamps", () => {
    const partition = partitionDatabaseListFields(fields);
    expect(partition.inlineFields).toEqual(fields.slice(0, 2));
    expect(partition.trailingFields).toEqual([fields[2]]);

    const template = databaseListGridTemplate(partition.trailingFields);
    expect(template).toContain("[title] minmax(0,1fr)");
    expect(template).toContain("[updated_at] minmax(60px,auto)");
    expect(template).not.toContain("property:assignee");
    expect(template).not.toContain("dynamic-");
  });

  test("removes optional core tracks without changing the title/property cluster", () => {
    const coreColumns = { priority: false, status: true };
    const template = databaseListGridTemplate([], coreColumns);
    expect(template).not.toContain("[priority]");
    expect(template).toContain("[status] 16px");
    expect(template).toContain("[title] minmax(0,1fr)");
  });

  test("adds an ordering field only to the current List session without duplicating it", () => {
    const created = { kind: "intrinsic", field: "created_at" } as const;
    expect(withForcedDatabaseListField(fields, created)).toEqual([...fields, created]);
    expect(withForcedDatabaseListField([...fields, created], created)).toEqual([
      ...fields,
      created,
    ]);
    expect(withForcedDatabaseListField(fields, null)).toBe(fields);
  });
});
