import { describe, expect, test } from "vitest";
import {
  createGeneralInlineDatabaseViewConfig,
  createLegacyInlineDatabaseViewConfig,
  evaluateDatabaseViewRows,
  inlineDatabaseViewId,
  type DatabaseViewReadModel,
} from "./database-views";
import {
  evaluateDatabaseViewFilter,
  parseDatabaseViewConfig,
} from "./database-kernel";
import type { DatabasePageSummary } from "./types";
import { authorizedReadStampFixture } from "./testing/authorized-read-stamp-fixture";

const encodeBase64Url = (value: string): string =>
  btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");

const makePage = (
  id: string,
  status: DatabasePageSummary["status"],
  priority: DatabasePageSummary["priority"],
): DatabasePageSummary => ({
  id,
  pageKey: null,
  status,
  archived: false,
  title: id,
  richTitle: [{ type: "text", text: id, styles: {} }],
  priority,
  tags: [],
  created: new Date("2026-01-01T00:00:00.000Z"),
  order: 0,
  descriptionPreview: "",
  descriptionLength: 0,
  hasDescription: false,
});

const makeReadModel = (includeHostCard: boolean): DatabaseViewReadModel => {
  const rules = {
    mode: "advanced",
    includeHostCard,
    filter: {
      any: [{ all: [{ field: "status", op: "in", values: ["build"] }] }],
    },
    sort: [{ field: "priority", direction: "asc" }],
  };
  const config = createLegacyInlineDatabaseViewConfig({
    sourceBlockId: "inline-query",
    props: {
      sourceProjectId: "source-project",
      rulesV2B64: encodeBase64Url(JSON.stringify(rules)),
    },
  });
  return {
    libraryId: "library:test",
    storeEpoch: "epoch:test",
    commitSeq: 1,
    authorization: authorizedReadStampFixture({
      deliveryAddress: {
        kind: "project",
        library_id: "library:test",
        project_id: "source-project",
      },
      subject: { kind: "view", view_id: "view-query" },
      storeEpoch: "epoch:test",
    }),
    dataSourceId: "data-source-query",
    view: {
      id: "view-query",
      databaseBlockId: "database-query",
      projectId: "source-project",
      name: "Query",
      defaultLayout: "list",
      config: JSON.parse(
        JSON.stringify(config),
      ) as DatabaseViewReadModel["view"]["config"],
      isPrimary: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    rows: [
      {
        page: makePage("host-card", "build", "p0-critical"),
        groupKey: null,
        subgroupKey: null,
        rankKey: "a",
      },
      {
        page: makePage("filtered-backlog", "plan", "p0-critical"),
        groupKey: null,
        subgroupKey: null,
        rankKey: "b",
      },
      {
        page: makePage("p1-b", "build", "p1-high"),
        groupKey: null,
        subgroupKey: null,
        rankKey: "same",
      },
      {
        page: makePage("p1-a", "build", "p1-high"),
        groupKey: null,
        subgroupKey: null,
        rankKey: "same",
      },
      {
        page: makePage("p0-other", "build", "p0-critical"),
        groupKey: null,
        subgroupKey: null,
        rankKey: "z",
      },
    ],
  };
};

describe("durable Database View contracts", () => {
  test("compiles legacy inline rules into the canonical general View schema", () => {
    const rules = {
      includeHostCard: true,
      filter: {
        any: [
          {
            all: [
              { field: "status", op: "in", values: ["plan"] },
              { field: "tags", op: "hasNone", values: ["blocked"] },
            ],
          },
        ],
      },
      sort: [
        { field: "priority", direction: "asc" },
        { field: "created", direction: "desc" },
      ],
    };
    const config = createGeneralInlineDatabaseViewConfig({
      databaseBlockId: "database-primary",
      sourceBlockId: "inline-general",
      props: {
        sourceProjectId: "source-project",
        rulesV2B64: encodeBase64Url(JSON.stringify(rules)),
        propertyOrderCsv: "priority,status,tags",
        hiddenPropertiesCsv: "tags",
      },
    });

    expect(parseDatabaseViewConfig(config)).toEqual(config);
    expect(config.schemaKey).toBe("nodex.database-view");
    expect(config.options?.includeHostPage).toBe(true);
    expect(config.sort.map((sort) => sort.field.kind)).toEqual([
      "property",
      "created",
    ]);
    expect(config.display.propertyIds).toEqual([
      "database-primary:property:priority",
      "database-primary:property:status",
    ]);
    const values = new Map<string, string | readonly string[]>([
      ["database-primary:property:status", "plan"],
      ["database-primary:property:tags", ["customer"]],
    ]);
    expect(
      evaluateDatabaseViewFilter(config.filter, (id) => values.get(id)),
    ).toBe(true);
    values.set("database-primary:property:tags", ["blocked"]);
    expect(
      evaluateDatabaseViewFilter(config.filter, (id) => values.get(id)),
    ).toBe(false);
  });

  test("derives one durable inline view identity per source reference Block", () => {
    expect(inlineDatabaseViewId("inline-a")).toBe(
      "database-view:inline:inline-a",
    );
    expect(inlineDatabaseViewId("inline-b")).toBe(
      "database-view:inline:inline-b",
    );
  });

  test("preserves legacy rules losslessly while exposing durable view fields", () => {
    const rules = {
      mode: "advanced",
      includeHostCard: true,
      filter: {
        any: [
          { all: [{ field: "status", op: "in", values: ["build"] }] },
        ],
      },
      sort: [{ field: "priority", direction: "desc" }],
      futureRule: { keep: "exactly" },
    };
    const rulesV2B64 = encodeBase64Url(JSON.stringify(rules));
    const config = createLegacyInlineDatabaseViewConfig({
      sourceBlockId: "inline-a",
      props: {
        sourceProjectId: "source-project",
        rulesV2B64,
        propertyOrderCsv: "priority,status,priority",
        hiddenPropertiesCsv: "estimate,tags",
        showEmptyEstimate: "true",
        showEmptyPriority: "false",
      },
    });

    expect(config.schemaVersion).toBe(1);
    expect(config.options.includeHostCard).toBe(true);
    expect(config.display.propertyOrder.join(",")).toBe("priority,status");
    expect(config.display.hiddenProperties.join(",")).toBe("estimate,tags");
    expect(config.display.showEmptyEstimate).toBe(true);
    expect(config.display.showEmptyPriority).toBe(false);
    expect(config.legacy.rulesV2B64).toBe(rulesV2B64);
    expect(JSON.stringify(config.legacy.rulesV2)).toBe(JSON.stringify(rules));
    expect(JSON.stringify(config.filter)).toBe(JSON.stringify(rules.filter));
    expect(JSON.stringify(config.sort)).toBe(JSON.stringify(rules.sort));
  });

  test("retains malformed legacy bytes while using canonical safe defaults", () => {
    const config = createLegacyInlineDatabaseViewConfig({
      sourceBlockId: "inline-corrupt",
      props: {
        sourceProjectId: "source-project",
        rulesV2B64: "not-valid-base64-json",
      },
    });

    expect(config.legacy.rulesV2B64).toBe("not-valid-base64-json");
    expect(config.legacy.rulesV2 === null).toBe(true);
    expect(JSON.stringify(config.filter)).toBe(
      JSON.stringify({
        any: [
          {
            all: [
              {
                field: "status",
                op: "in",
                values: [
                  "triage",
                  "plan",
                  "build",
                  "review",
                  "ship",
                ],
              },
              {
                field: "priority",
                op: "in",
                values: [
                  "p0-critical",
                  "p1-high",
                  "p2-medium",
                  "p3-low",
                ],
                includeEmpty: true,
              },
            ],
          },
        ],
      }),
    );
    expect(JSON.stringify(config.sort)).toBe(
      JSON.stringify([
        { field: "board-order", direction: "asc" },
        { field: "created", direction: "desc" },
      ]),
    );
    expect(config.options.includeHostCard).toBe(false);
  });

  test("normalizes absent and partial effective rules while preserving provenance", () => {
    const noRules = createLegacyInlineDatabaseViewConfig({
      sourceBlockId: "inline-default",
      props: { sourceProjectId: "source-project" },
    });
    expect(noRules.legacy.rulesV2B64).toBe("");
    expect(noRules.legacy.rulesV2 === null).toBe(true);
    expect(noRules.options.includeHostCard).toBe(false);
    expect(JSON.stringify(noRules.sort)).toBe(
      JSON.stringify([
        { field: "board-order", direction: "asc" },
        { field: "created", direction: "desc" },
      ]),
    );

    const partialRules = {
      includeHostCard: "invalid",
      filter: { any: [{ all: [{ field: "future", op: "in", values: [] }] }] },
      sort: [{ field: "future", direction: "sideways" }],
      futureRule: { preserved: true },
    };
    const partialRulesV2B64 = encodeBase64Url(JSON.stringify(partialRules));
    const partial = createLegacyInlineDatabaseViewConfig({
      sourceBlockId: "inline-partial",
      props: {
        sourceProjectId: "source-project",
        rulesV2B64: partialRulesV2B64,
      },
    });
    expect(partial.legacy.rulesV2B64).toBe(partialRulesV2B64);
    expect(JSON.stringify(partial.legacy.rulesV2)).toBe(
      JSON.stringify(partialRules),
    );
    expect(JSON.stringify(partial.filter)).toBe(JSON.stringify(noRules.filter));
    expect(JSON.stringify(partial.sort)).toBe(JSON.stringify(noRules.sort));
    expect(partial.options.includeHostCard).toBe(false);
  });

  test("compiles retired P4 filters to P3 while retaining raw provenance", () => {
    const rules = {
      filter: {
        any: [
          {
            all: [
              {
                field: "priority",
                op: "in",
                values: ["p4-later", "p3-low"],
                includeEmpty: false,
              },
            ],
          },
        ],
      },
      sort: [{ field: "priority", direction: "asc" }],
    };
    const rulesV2B64 = encodeBase64Url(JSON.stringify(rules));
    const config = createLegacyInlineDatabaseViewConfig({
      sourceBlockId: "inline-p4-cutover",
      props: { sourceProjectId: "source-project", rulesV2B64 },
    });

    expect(config.filter).toEqual({
      any: [
        {
          all: [
            {
              field: "priority",
              op: "in",
              values: ["p3-low"],
              includeEmpty: false,
            },
          ],
        },
      ],
    });
    expect(config.legacy.rulesV2B64).toBe(rulesV2B64);
    expect(config.legacy.rulesV2).toEqual(rules);
  });

  test("derives omitted legacy empty-priority semantics before P4 collapses", () => {
    const compile = (values: string[]) => createLegacyInlineDatabaseViewConfig({
      sourceBlockId: `inline-${values.length}`,
      props: {
        sourceProjectId: "source-project",
        rulesV2B64: encodeBase64Url(JSON.stringify({
          filter: {
            any: [{
              all: [{ field: "priority", op: "in", values }],
            }],
          },
        })),
      },
    });
    const clause = (values: string[]) => {
      const config = compile(values);
      return (config.filter as {
        any: readonly { all: readonly { includeEmpty?: boolean }[] }[];
      }).any[0]?.all[0];
    };

    expect(clause([
      "p0-critical",
      "p1-high",
      "p2-medium",
      "p3-low",
    ])?.includeEmpty).toBe(false);
    expect(clause([
      "p0-critical",
      "p1-high",
      "p2-medium",
      "p3-low",
      "p4-later",
    ])?.includeEmpty).toBe(true);
  });

  test("keeps an explicit empty-priority exclusion and defaults an empty sort", () => {
    const rules = {
      includeHostCard: true,
      filter: {
        any: [
          {
            all: [
              {
                field: "priority",
                op: "in",
                values: [
                  "p0-critical",
                  "p1-high",
                  "p2-medium",
                  "p3-low",
                  "p4-later",
                ],
                includeEmpty: false,
              },
            ],
          },
        ],
      },
      sort: [],
    };
    const config = createLegacyInlineDatabaseViewConfig({
      sourceBlockId: "inline-no-empty-priority",
      props: {
        sourceProjectId: "source-project",
        rulesV2B64: encodeBase64Url(JSON.stringify(rules)),
      },
    });
    const filter = config.filter as {
      any: readonly { all: readonly { includeEmpty?: boolean }[] }[];
    };
    expect(filter.any[0]?.all[0]?.includeEmpty).toBe(false);
    expect(config.sort.length).toBe(2);

    const base = makeReadModel(true);
    const rows = evaluateDatabaseViewRows({
      ...base,
      view: { ...base.view, config: JSON.parse(JSON.stringify(config)) },
      rows: [
        {
          page: makePage("empty", "triage", undefined),
          groupKey: "triage",
          subgroupKey: null,
          rankKey: "a",
        },
        {
          page: makePage("prioritized", "triage", "p1-high"),
          groupKey: "triage",
          subgroupKey: null,
          rankKey: "b",
        },
      ],
    });
    expect(rows.map((row) => row.page.id).join(",")).toBe("prioritized");
  });

  test("evaluates migrated filter, stable sort, and host inclusion semantics", () => {
    const excludesHost = makeReadModel(false);
    const rows = evaluateDatabaseViewRows(excludesHost, {
      hostBlockId: "host-card",
    });
    expect(rows.map((row) => row.page.id).join(",")).toBe("p0-other,p1-a,p1-b");

    const includesHost = makeReadModel(true);
    expect(
      evaluateDatabaseViewRows(includesHost, { hostBlockId: "host-card" })
        .map((row) => row.page.id)
        .join(","),
    ).toBe("host-card,p0-other,p1-a,p1-b");
  });

  test("invalid effective filters use safe defaults and still exclude the host", () => {
    const model = makeReadModel(false);
    const malformed: DatabaseViewReadModel = {
      ...model,
      view: {
        ...model.view,
        config: {
          ...model.view.config,
          filter: {
            any: [{ all: [{ field: "future", op: "unknown", values: [] }] }],
          },
        },
      },
    };
    const rows = evaluateDatabaseViewRows(malformed, {
      hostBlockId: "host-card",
    });
    expect(rows.map((row) => row.page.id).join(",")).toBe(
      "filtered-backlog,p0-other,p1-a,p1-b",
    );
  });

  test("defaults invalid sorts to semantic board order with a stable created tie-break", () => {
    const model = makeReadModel(true);
    const boardModel: DatabaseViewReadModel = {
      ...model,
      view: {
        ...model.view,
        config: {
          ...model.view.config,
          filter: { any: [] },
          sort: [{ field: "future", direction: "desc" }],
        },
      },
      rows: [
        {
          ...model.rows[0],
          page: {
            ...model.rows[0].page,
            id: "ship",
            status: "ship",
            created: new Date("2026-01-03T00:00:00.000Z"),
          },
          groupKey: "triage",
          rankKey: "000",
        },
        {
          ...model.rows[0],
          page: {
            ...model.rows[0].page,
            id: "draft-old",
            status: "triage",
            created: new Date("2026-01-01T00:00:00.000Z"),
          },
          groupKey: "ship",
          rankKey: "same",
        },
        {
          ...model.rows[0],
          page: {
            ...model.rows[0].page,
            id: "draft-new",
            status: "triage",
            created: new Date("2026-01-02T00:00:00.000Z"),
          },
          groupKey: "ship",
          rankKey: "same",
        },
        {
          ...model.rows[0],
          page: {
            ...model.rows[0].page,
            id: "progress",
            status: "build",
          },
          groupKey: "ship",
          rankKey: "500",
        },
      ],
    };

    expect(
      evaluateDatabaseViewRows(boardModel, { hostBlockId: "host-card" })
        .map((row) => row.page.id)
        .join(","),
    ).toBe("draft-new,draft-old,progress,ship");
  });
});
