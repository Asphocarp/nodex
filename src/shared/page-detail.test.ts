import { describe, expect, test } from "vitest";

import { plainTextToPortableRichText } from "./block-documents";
import {
  PageDetailContractError,
  parsePageDetailResult,
  type PageDetailResult,
} from "./page-detail";

const timestamp = "2026-07-16T00:00:00.000Z";

const memberResult = (): PageDetailResult => ({
  ok: true,
  value: {
    version: 1,
    projectId: "project-1",
    libraryId: "library-1",
    storeEpoch: "epoch-1",
    changeLogSeq: 2,
    page: {
      pageId: "page-1",
      libraryId: "library-1",
      parent: { kind: "data_source", dataSourceId: "source-1" },
      lifecycle: "active",
      parentRevision: 1,
      metadataRevision: 1,
      documentId: "document-1",
      documentGeneration: 1,
      documentHeadSeq: 1,
      title: "Page",
      richTitle: plainTextToPortableRichText("Page"),
      preview: "",
      plainText: "",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    document: {
      readiness: "ready",
      schemaKey: "nodex.page",
      schemaVersion: 2,
    },
    intrinsicProperties: [],
    dataSourceContext: {
      kind: "member",
      membership: {
        membershipId: "membership-1",
        dataSourceId: "source-1",
        revision: 1,
        createdAt: timestamp,
      },
      database: {
        databaseId: "database-1",
        libraryId: "library-1",
        name: "Database",
        lifecycle: "active",
        defaultViewId: "view-1",
        accessRevision: 1,
        metadataRevision: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      dataSource: {
        dataSourceId: "source-1",
        libraryId: "library-1",
        homeDatabaseId: "database-1",
        name: "Pages",
        schemaKey: "nodex.data-source",
        schemaRevision: 1,
        lifecycle: "active",
        rankKey: "a0",
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      properties: [{
        propertyId: "property-status",
        dataSourceId: "source-1",
        key: "status",
        name: "Status",
        valueType: "select",
        config: { options: [{ id: "draft", name: "Draft" }] },
        rankKey: "a0",
        lifecycle: "active",
        revision: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
      }],
      values: {
        "property-status": {
          propertyId: "property-status",
          valueType: "select",
          value: "draft",
          revision: 1,
        },
      },
    },
  },
});

describe("Page Detail contract", () => {
  test("accepts one coherent Page → Data Source → Database ownership chain", () => {
    const parsed = parsePageDetailResult(memberResult());
    expect(parsed.ok && parsed.value.page.parent).toEqual({
      kind: "data_source",
      dataSourceId: "source-1",
    });
  });

  test("rejects a membership that differs from the exclusive Page parent", () => {
    const result = structuredClone(memberResult());
    if (!result.ok || result.value.dataSourceContext.kind !== "member") return;
    const mutable = result.value.dataSourceContext.membership as {
      dataSourceId: string;
    };
    mutable.dataSourceId = "source-2";

    expect(() => parsePageDetailResult(result)).toThrow(
      "Page parent and Data Source membership diverge",
    );
  });

  test("rejects a property value whose identity is not in the Source schema", () => {
    const result = structuredClone(memberResult()) as unknown as {
      ok: true;
      value: {
        dataSourceContext: {
          values: Record<string, unknown>;
        };
      };
    };
    result.value.dataSourceContext.values["unknown-property"] = {
      propertyId: "unknown-property",
      valueType: "text",
      value: "leak",
      revision: 1,
    };

    expect(() => parsePageDetailResult(result)).toThrow(
      PageDetailContractError,
    );
  });
});
