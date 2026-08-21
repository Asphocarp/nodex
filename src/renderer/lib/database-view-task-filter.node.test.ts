import { describe, expect, test } from "vitest";

import type { DataSourcePropertyRecordV2 } from "../../shared/database-module-v2";
import { parseDataSourceId, parseDataSourcePropertyId } from "../../shared/database-identities";
import { testPropertySemantics } from "../../shared/testing/database-property-record";
import {
  createDefaultDatabaseTaskFilterGroup,
  decodeDatabaseTaskFilter,
  encodeDatabaseTaskFilter,
  resolveDatabaseTaskFilterCapabilities,
} from "./database-view-task-filter";

const timestamp = "2026-08-12T00:00:00.000Z";
const dataSourceId = parseDataSourceId("source:task-filter");
const property = (
  propertyId: "status" | "priority" | "tags",
  valueType: "select" | "multi_select",
): DataSourcePropertyRecordV2 => ({
  propertyId: parseDataSourcePropertyId(propertyId),
  dataSourceId,
  name: propertyId[0]!.toUpperCase() + propertyId.slice(1),
  ...testPropertySemantics(valueType, 2),
  valueType,
  config: {
    options: [
      { id: "a", name: "A" },
      { id: "b", name: "B" },
    ],
  },
  rankKey: propertyId,
  lifecycle: "active",
  revision: 1,
  createdAt: timestamp,
  updatedAt: timestamp,
});
const capabilities = resolveDatabaseTaskFilterCapabilities([
  property("status", "select"),
  property("priority", "select"),
  property("tags", "multi_select"),
]);

describe("database task filter adapter", () => {
  test("projects an empty durable filter into the familiar all-selected task controls", () => {
    const decoded = decodeDatabaseTaskFilter(
      { kind: "group", operator: "and", children: [] },
      capabilities,
    );

    expect(decoded?.groups).toEqual([createDefaultDatabaseTaskFilterGroup(capabilities)]);
    expect(encodeDatabaseTaskFilter(decoded!, capabilities)).toEqual({
      kind: "group",
      operator: "and",
      children: [],
    });
  });

  test("round-trips multi-choice status, empty priority, and tag modes", () => {
    const encoded = encodeDatabaseTaskFilter(
      {
        groups: [
          {
            status: { selectedOptionIds: ["a"], includeEmpty: false },
            priority: { selectedOptionIds: ["b"], includeEmpty: true },
            tags: { selectedOptionIds: ["a", "b"], mode: "all" },
          },
        ],
      },
      capabilities,
    );

    expect(decodeDatabaseTaskFilter(encoded, capabilities)).toEqual({
      groups: [
        {
          status: { selectedOptionIds: ["a"], includeEmpty: false },
          priority: { selectedOptionIds: ["b"], includeEmpty: true },
          tags: { selectedOptionIds: ["a", "b"], mode: "all" },
        },
      ],
    });
  });

  test("declines filters that require the generic editor", () => {
    expect(
      decodeDatabaseTaskFilter(
        {
          kind: "clause",
          propertyId: "custom:text",
          operator: "contains",
          value: "agent",
        },
        capabilities,
      ),
    ).toBeNull();
  });

  test("keeps an all-deselected choice representable without falling back", () => {
    const encoded = encodeDatabaseTaskFilter(
      {
        groups: [
          {
            ...createDefaultDatabaseTaskFilterGroup(capabilities),
            status: { selectedOptionIds: [], includeEmpty: false },
          },
        ],
      },
      capabilities,
    );

    expect(decodeDatabaseTaskFilter(encoded, capabilities)?.groups[0]?.status).toEqual({
      selectedOptionIds: [],
      includeEmpty: false,
    });
  });
});
