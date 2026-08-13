import { describe, expect, test } from "vitest";

import type { DatabaseViewField } from "../../../../shared/database-kernel";
import {
  databaseListGridTemplate,
  databaseListIdentifierMinWidth,
  databaseListIdentifierSamples,
  partitionDatabaseListFields,
  projectDatabaseListPageIdentity,
  withForcedDatabaseListField,
} from "./database-list-grid";

const fields: readonly DatabaseViewField[] = [
  { kind: "property", propertyId: "assignee" },
  { kind: "property", propertyId: "labels" },
  { kind: "intrinsic", field: "updated_at" },
];

describe("Database List field registry", () => {
  test("packs properties into the title cell and reserves grid tracks only for timestamps", () => {
    const partition = partitionDatabaseListFields([
      { kind: "intrinsic", field: "page_key" },
      ...fields,
    ]);
    expect(partition.identityFields).toEqual(["page_key"]);
    expect(partition.inlineFields).toEqual(fields.slice(0, 2));
    expect(partition.trailingFields).toEqual([fields[2]]);

    const template = databaseListGridTemplate(partition.trailingFields, {
      identifier: true,
      priority: true,
      status: true,
    }, 51);
    expect(template).toContain("[title] minmax(0,1fr)");
    expect(template).toContain("[identifier] minmax(51px,auto)");
    expect(template).toContain("[updated_at] minmax(60px,auto)");
    expect(template).not.toContain("property:assignee");
    expect(template).not.toContain("dynamic-");
  });

  test("removes optional core tracks without changing the title/property cluster", () => {
    const coreColumns = { identifier: false, priority: false, status: true };
    const template = databaseListGridTemplate([], coreColumns);
    expect(template).not.toContain("[priority]");
    expect(template).toContain("[identifier status] 20px");
    expect(template).not.toContain("[identifier] minmax");
    expect(template).toContain("[title] minmax(0,1fr)");
  });

  test("removes the public ID from its visible grid track", () => {
    const partition = partitionDatabaseListFields(fields);
    expect(partition.identityFields).toEqual([]);

    const template = databaseListGridTemplate(partition.trailingFields, {
      identifier: partition.identityFields.length > 0,
      priority: true,
      status: true,
    });
    expect(template).toContain("[identifier status] 20px");
    expect(template).not.toContain("[identifier] minmax");
    expect(partition.trailingFields).toEqual([{ kind: "intrinsic", field: "updated_at" }]);
  });

  test("aliases the hidden identifier boundary onto a real track in every core layout", () => {
    expect(databaseListGridTemplate([], {
      identifier: false,
      priority: true,
      status: true,
    })).toContain("[identifier status] 20px");
    expect(databaseListGridTemplate([], {
      identifier: false,
      priority: true,
      status: false,
    })).toContain("[identifier title] minmax(0,1fr)");
  });

  test("measures each prefix and number depth instead of imposing a three-letter width", () => {
    const twoCharacterSamples = databaseListIdentifierSamples(
      ["NO-1", "NO-13"],
      (pageKey) => pageKey,
    );
    const threeCharacterSamples = databaseListIdentifierSamples(
      ["NOD-1", "NOD-13"],
      (pageKey) => pageKey,
    );
    expect(twoCharacterSamples).toHaveLength(10);
    expect(twoCharacterSamples).toContain("NO-88");
    expect(threeCharacterSamples).toContain("NOD-88");

    const measure = (value: string): number => value.length * 7;
    const twoCharacterWidth = databaseListIdentifierMinWidth(
      twoCharacterSamples,
      measure,
    );
    const threeCharacterWidth = databaseListIdentifierMinWidth(
      threeCharacterSamples,
      measure,
    );
    expect(twoCharacterWidth).toBe(35);
    expect(threeCharacterWidth).toBe(42);
    expect(databaseListGridTemplate([], undefined, twoCharacterWidth)).toContain(
      "[identifier] minmax(35px,auto)",
    );
  });

  test("uses the widest plausible numeral without measuring every row", () => {
    const samples = databaseListIdentifierSamples(
      ["NO-1", "NO-999", "LAB-20", null, "not-a-key"],
      (pageKey) => pageKey,
    );
    expect(samples).toHaveLength(20);
    expect(samples).toContain("NO-888");
    expect(samples).toContain("LAB-88");
    expect(databaseListIdentifierMinWidth(samples, (value) =>
      value.includes("8") ? value.length * 6 : value.length * 5
    )).toBe(36);
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

  test("projects only the readable ID into the measured identity lane", () => {
    const identityFields = partitionDatabaseListFields([
      { kind: "intrinsic", field: "page_key" },
    ]).identityFields;
    expect(projectDatabaseListPageIdentity(
      "LAB-13",
      identityFields,
    )).toEqual({
      label: "LAB-13",
      title: "LAB-13",
    });
  });

  test("projects a high-cardinality row model in one linear pass", () => {
    const identities = Array.from({ length: 10_000 }, (_, index) =>
      projectDatabaseListPageIdentity(
        `LAB-${index + 1}`,
        ["page_key"],
      ));
    expect(identities).toHaveLength(10_000);
    expect(identities[0]?.label).toBe("LAB-1");
    expect(identities.at(-1)?.label).toBe("LAB-10000");
  });
});
