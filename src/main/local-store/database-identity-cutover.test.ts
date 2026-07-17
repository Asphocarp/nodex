import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import {
  canonicalizeBlockPropertyMutationRequest,
  makeBlockPropertyFieldPath,
  parseBlockPropertyMutationRequest,
  stableStringifyBlockPropertyJson,
} from "../../shared/block-property-mutations";
import {
  parseBlockPropertyMutationRequestV2,
  parseBlockPropertyMutationResultV2,
} from "../../shared/block-property-mutations-v2";
import { parseDataSourcePropertyId } from "../../shared/database-identities";
import {
  databaseGroupValueFromKey,
} from "../../shared/database-kernel";
import { parsePageLifecycleMutationReceipt } from "../../shared/page-lifecycle";
import {
  allocateDeterministicOptionIdentity,
  allocateDeterministicPropertyIdentity,
  createOptionIdentityMappings,
  createPropertyIdentityMappings,
  DatabaseIdentityCutoverError,
  deterministicOptionIdCandidate,
  deterministicPropertyIdCandidate,
  rewriteCommittedBlockPropertyEvidence,
  rewriteCommittedPageLifecycleCreateEvidence,
  rewriteDatabaseViewConfigV1ToV2,
  rewriteDatabaseViewPositionGroupKey,
  type BlockPropertyEvidenceAggregate,
  type PageLifecycleCreateEvidenceAggregate,
} from "./database-identity-cutover";

const OLD_TAGS_PROPERTY = "database:db-1:property:tags";
const OLD_STATUS_PROPERTY = "database:db-1:property:status";

const propertyMappings = createPropertyIdentityMappings([
  {
    dataSourceId: "source-1",
    oldPropertyId: OLD_TAGS_PROPERTY,
    reservedPropertyId: "tags",
  },
  {
    dataSourceId: "source-1",
    oldPropertyId: OLD_STATUS_PROPERTY,
    reservedPropertyId: "status",
  },
  {
    dataSourceId: "source-1",
    oldPropertyId: "database:db-1:property:custom",
  },
]);

const tagsMapping = propertyMappings.find(
  (mapping) => mapping.oldPropertyId === OLD_TAGS_PROPERTY,
);
if (!tagsMapping) throw new Error("Missing Tags Property mapping fixture");

const optionMappings = createOptionIdentityMappings([
  {
    dataSourceId: "source-1",
    oldPropertyId: OLD_TAGS_PROPERTY,
    newPropertyId: tagsMapping.newPropertyId,
    oldOptionId: "Legacy Blue",
  },
  {
    dataSourceId: "source-1",
    oldPropertyId: OLD_TAGS_PROPERTY,
    newPropertyId: tagsMapping.newPropertyId,
    oldOptionId: "Legacy Red",
  },
  {
    dataSourceId: "source-1",
    oldPropertyId: OLD_STATUS_PROPERTY,
    newPropertyId: parseDataSourcePropertyId("status"),
    oldOptionId: "draft",
  },
]);

const mappedOption = (oldOptionId: string): string => {
  const mapping = optionMappings.find(
    (candidate) => candidate.oldOptionId === oldOptionId,
  );
  if (!mapping) throw new Error(`Missing option mapping ${oldOptionId}`);
  return mapping.newOptionId;
};

describe("Database identity cutover primitives", () => {
  test("derives stable six-byte base64url IDs and advances collision counters", () => {
    const property0 = deterministicPropertyIdCandidate({
      dataSourceId: "source-1",
      oldPropertyId: "old-property",
      collisionCounter: 0,
    });
    const property1 = deterministicPropertyIdCandidate({
      dataSourceId: "source-1",
      oldPropertyId: "old-property",
      collisionCounter: 1,
    });
    expect(property0).toBe("p_3PVufOQS");
    expect(property1).toBe("p_wwOJSatO");
    expect(
      allocateDeterministicPropertyIdentity({
        dataSourceId: "source-1",
        oldPropertyId: "old-property",
        isTaken: (candidate) => candidate === property0,
      }),
    ).toEqual({ newPropertyId: property1, collisionCounter: 1 });

    const customProperty = propertyMappings.find(
      (mapping) => mapping.oldPropertyId.endsWith(":custom"),
    );
    if (!customProperty) throw new Error("Missing custom Property fixture");
    const option0 = deterministicOptionIdCandidate({
      dataSourceId: "source-1",
      newPropertyId: customProperty.newPropertyId,
      oldOptionId: "old-option",
      collisionCounter: 0,
    });
    const option1 = deterministicOptionIdCandidate({
      dataSourceId: "source-1",
      newPropertyId: customProperty.newPropertyId,
      oldOptionId: "old-option",
      collisionCounter: 1,
    });
    expect(option0).toMatch(/^o_[A-Za-z0-9_-]{8}$/u);
    expect(
      allocateDeterministicOptionIdentity({
        dataSourceId: "source-1",
        newPropertyId: customProperty.newPropertyId,
        oldOptionId: "old-option",
        isTaken: (candidate) => candidate === option0,
      }),
    ).toEqual({ newOptionId: option1, collisionCounter: 1 });
  });

  test("preserves reserved Properties and valid owner-scoped options", () => {
    expect(tagsMapping).toMatchObject({
      newPropertyId: "tags",
      collisionCounter: null,
    });
    expect(mappedOption("draft")).toBe("draft");
    expect(mappedOption("Legacy Red")).toMatch(/^o_[A-Za-z0-9_-]{8}$/u);
  });

  test("rewrites nested View config Property and option coordinates to v2", () => {
    const rewritten = rewriteDatabaseViewConfigV1ToV2({
      dataSourceId: "source-1",
      propertyMappings,
      optionMappings,
      config: {
        schemaKey: "nodex.database-view",
        schemaVersion: 1,
        filter: {
          kind: "group",
          operator: "and",
          children: [
            {
              kind: "clause",
              propertyId: OLD_STATUS_PROPERTY,
              operator: "equals",
              value: "draft",
            },
            {
              kind: "clause",
              propertyId: OLD_TAGS_PROPERTY,
              operator: "contains",
              value: "Legacy Red",
            },
          ],
        },
        sort: [
          {
            field: { kind: "property", propertyId: OLD_TAGS_PROPERTY },
            direction: "asc",
            nulls: "last",
          },
        ],
        group: { propertyId: OLD_STATUS_PROPERTY },
        display: {
          propertyIds: [OLD_STATUS_PROPERTY, OLD_TAGS_PROPERTY],
          showTitle: true,
        },
      },
    });

    expect(rewritten.schemaVersion).toBe(2);
    expect(rewritten.group?.propertyId).toBe("status");
    expect(rewritten.display.propertyIds).toEqual(["status", "tags"]);
    expect(rewritten.sort[0]?.field).toEqual({
      kind: "property",
      propertyId: "tags",
    });
    expect(rewritten.filter).toMatchObject({
      children: [
        { propertyId: "status", value: "draft" },
        { propertyId: "tags", value: mappedOption("Legacy Red") },
      ],
    });
  });

  test("round-trips real View group-key encoding while rewriting option IDs", () => {
    expect(
      rewriteDatabaseViewPositionGroupKey({
        dataSourceId: "source-1",
        oldPropertyId: OLD_STATUS_PROPERTY,
        valueType: "select",
        groupKey: "draft",
        propertyMappings,
        optionMappings,
      }),
    ).toBe("draft");
    const rewrittenMulti = rewriteDatabaseViewPositionGroupKey({
      dataSourceId: "source-1",
      oldPropertyId: OLD_TAGS_PROPERTY,
      valueType: "multi_select",
      groupKey: stableStringifyBlockPropertyJson([
        "Legacy Red",
        "Legacy Blue",
      ]),
      propertyMappings,
      optionMappings,
    });
    expect(
      databaseGroupValueFromKey("multi_select", rewrittenMulti),
    ).toEqual(
      [mappedOption("Legacy Blue"), mappedOption("Legacy Red")].sort(),
    );
    expect(() =>
      rewriteDatabaseViewPositionGroupKey({
        dataSourceId: "source-1",
        oldPropertyId: OLD_TAGS_PROPERTY,
        valueType: "multi_select",
        groupKey: "Legacy Red",
        propertyMappings,
        optionMappings,
      }),
    ).toThrow(/not an option array/u);
  });
});

const createCommittedEvidence = (): BlockPropertyEvidenceAggregate => {
  const requestObject = {
    version: 1,
    mutationId: "mutation-1",
    projectId: "project-1",
    storeEpoch: "epoch-1",
    actor: { kind: "user" },
    fields: [
      {
        scope: "database",
        pageId: "page-1",
        databaseBlockId: "db-1",
        propertyId: OLD_TAGS_PROPERTY,
        operation: "add_remove",
        add: ["Legacy Red"],
        remove: ["Legacy Blue"],
      },
    ],
  };
  const request = parseBlockPropertyMutationRequest(requestObject);
  const requestJson = canonicalizeBlockPropertyMutationRequest(request);
  const requestHash = createHash("sha256").update(requestJson).digest("hex");
  const field = request.fields[0];
  if (!field) throw new Error("Missing request field fixture");
  const path = makeBlockPropertyFieldPath(field);
  const fieldIntents = [
    {
      path,
      operation: "add_remove",
      scope: "database",
      add: ["Legacy Red"],
      remove: ["Legacy Blue"],
    },
  ];
  const result = {
    version: 1,
    mutationId: "mutation-1",
    projectId: "project-1",
    storeEpoch: "epoch-1",
    duplicate: false,
    fields: [
      {
        path,
        scope: "database",
        blockId: "page-1",
        databaseBlockId: "db-1",
        propertyId: OLD_TAGS_PROPERTY,
        operation: "add_remove",
        revision: 2,
        value: ["Legacy Red"],
      },
    ],
    blockMetadataRevisions: { "page-1": 3 },
    changeLogSeq: 7,
    committedAt: "2026-07-18T00:00:00.000Z",
  };
  return {
    mutationKind: "property_batch",
    outcome: "committed",
    requestJson,
    requestHash,
    fieldIntentsJson: stableStringifyBlockPropertyJson(fieldIntents),
    expectedRevisionsJson: "{}",
    resultJson: stableStringifyBlockPropertyJson(result),
    committedRevisionsJson: stableStringifyBlockPropertyJson({ [path]: 2 }),
    changePayloadJson: stableStringifyBlockPropertyJson({
      version: 1,
      requestHash,
      fieldPaths: [path],
      fieldChanges: [
        {
          path,
          scope: "database",
          operation: "add_remove",
          before: { exists: true, revision: 1, value: ["Legacy Blue"] },
          after: { exists: true, revision: 2, value: ["Legacy Red"] },
        },
      ],
      committedRevisions: { [path]: 2 },
      blockMetadataRevisions: { "page-1": 3 },
    }),
  };
};

describe("Block Property evidence cutover", () => {
  test("rewrites the complete committed evidence aggregate coherently", () => {
    const rewritten = rewriteCommittedBlockPropertyEvidence({
      evidence: createCommittedEvidence(),
      propertyMappings,
      optionMappings,
    });
    expect(rewritten.kind).toBe("rewritten_committed");
    if (rewritten.kind !== "rewritten_committed") {
      throw new Error("Expected rewritten committed evidence");
    }
    expect(
      createHash("sha256")
        .update(rewritten.evidence.requestJson)
        .digest("hex"),
    ).toBe(rewritten.evidence.requestHash);
    const request = parseBlockPropertyMutationRequestV2(
      JSON.parse(rewritten.evidence.requestJson) as unknown,
    );
    expect(request.fields[0]).toMatchObject({
      scope: "data_source",
      pageId: "page-1",
      dataSourceId: "source-1",
      propertyId: "tags",
      add: [mappedOption("Legacy Red")],
      remove: [mappedOption("Legacy Blue")],
    });
    const result = parseBlockPropertyMutationResultV2(
      JSON.parse(rewritten.evidence.resultJson) as unknown,
    );
    expect(result.fields[0]).toMatchObject({
      scope: "data_source",
      dataSourceId: "source-1",
      propertyId: "tags",
      value: [mappedOption("Legacy Red")],
    });
    const changePayload = JSON.parse(
      rewritten.evidence.changePayloadJson,
    ) as {
      readonly requestHash: string;
      readonly fieldPaths: readonly string[];
      readonly fieldChanges: readonly {
        readonly before: { readonly value: readonly string[] };
        readonly after: { readonly value: readonly string[] };
      }[];
    };
    expect(changePayload.requestHash).toBe(rewritten.evidence.requestHash);
    expect(changePayload.fieldPaths).toEqual([result.fields[0]?.path]);
    expect(changePayload.fieldChanges[0]?.before.value).toEqual([
      mappedOption("Legacy Blue"),
    ]);
    expect(changePayload.fieldChanges[0]?.after.value).toEqual([
      mappedOption("Legacy Red"),
    ]);
    expect(JSON.stringify(rewritten.evidence)).not.toContain(OLD_TAGS_PROPERTY);
    expect(JSON.stringify(rewritten.evidence)).not.toContain("Legacy Red");
  });

  test("distinguishes rejected and unrelated evidence without rewriting it", () => {
    expect(
      rewriteCommittedBlockPropertyEvidence({
        evidence: { ...createCommittedEvidence(), outcome: "rejected" },
        propertyMappings,
        optionMappings,
      }),
    ).toEqual({
      kind: "retained_rejected",
      reason: "rejected_evidence_is_literal",
    });
    expect(
      rewriteCommittedBlockPropertyEvidence({
        evidence: {
          ...createCommittedEvidence(),
          mutationKind: "document_operation_batch",
        },
        propertyMappings,
        optionMappings,
      }),
    ).toEqual({ kind: "unknown_evidence", reason: "not_property_batch" });
  });

  test("fails closed on corrupt coupled evidence", () => {
    expect(() =>
      rewriteCommittedBlockPropertyEvidence({
        evidence: {
          ...createCommittedEvidence(),
          requestHash: "f".repeat(64),
        },
        propertyMappings,
        optionMappings,
      }),
    ).toThrow(DatabaseIdentityCutoverError);
    expect(() =>
      rewriteCommittedBlockPropertyEvidence({
        evidence: {
          ...createCommittedEvidence(),
          committedRevisionsJson: "{}",
        },
        propertyMappings,
        optionMappings,
      }),
    ).toThrow(/result revisions diverge/u);
  });
});

const createPageLifecycleEvidence = (): PageLifecycleCreateEvidenceAggregate => {
  const operation = {
    kind: "create_page",
    pageId: "page-created",
    title: "Created Page",
    nfm: "# Created Page",
    status: "draft",
    priority: null,
    estimate: null,
    tags: ["Legacy Red", "Legacy Blue"],
    dueDate: null,
    scheduledStart: null,
    scheduledEnd: null,
    isAllDay: false,
    recurrence: null,
    reminders: [],
    scheduleTimezone: null,
    assignee: null,
    runInTarget: "localProject",
    runInLocalPath: null,
    runInBaseBranch: null,
    runInWorktreePath: null,
    runInEnvironmentPath: null,
  };
  const requestJson = stableStringifyBlockPropertyJson({
    version: 1,
    projectId: "project-1",
    operation,
  });
  const requestHash = createHash("sha256").update(requestJson).digest("hex");
  const receipt = parsePageLifecycleMutationReceipt({
    version: 1,
    operationId: "create-page-1",
    projectId: "project-1",
    storeEpoch: "epoch-1",
    operationKind: "create_page",
    pageId: "page-created",
    duplicate: false,
    metadataRevision: 1,
    parentRevision: 1,
    lifecycle: "active",
    documentId: "document:page-created",
    documentGeneration: 1,
    documentHeadSeq: 1,
    databaseId: "db-1",
    dataSourceId: "source-1",
    membershipId: "membership-1",
    viewId: "view-1",
    libraryRankKey: null,
    viewRankKey: null,
    createdBlockIds: ["page-created"],
    changeLogSeq: 9,
    committedAt: "2026-07-18T01:00:00.000Z",
  });
  const createdOptionIntent =
    `databases.db-1.properties.${OLD_TAGS_PROPERTY}.options.Legacy Red`;
  return {
    mutationKind: "page_lifecycle",
    outcome: "committed",
    requestJson,
    requestHash,
    fieldIntentsJson: stableStringifyBlockPropertyJson([
      { path: "blocks.page-created", operation: "create" },
      { path: "documents.document:page-created", operation: "genesis" },
      { path: "memberships.membership-1", operation: "create" },
      { path: createdOptionIntent, operation: "add" },
    ]),
    resultJson: stableStringifyBlockPropertyJson(receipt),
    changePayloadJson: stableStringifyBlockPropertyJson({
      operation: "create_page",
      pageId: "page-created",
      documentId: "document:page-created",
      databaseId: "db-1",
      membershipId: "membership-1",
      viewId: "view-1",
      status: "draft",
      createdBlockIds: ["page-created"],
      libraryRankKey: null,
      viewRankKey: null,
      rebalancedTopLevelPlacements: [],
      rebalancedViewPositions: 0,
      createdTagOptionIds: ["Legacy Red"],
      mutationKind: "page_lifecycle",
      requestHash,
    }),
  };
};

describe("Page Lifecycle create evidence cutover", () => {
  test("preserves v1 create evidence while rewriting authoritative option references", () => {
    const evidence = createPageLifecycleEvidence();
    const rewritten = rewriteCommittedPageLifecycleCreateEvidence({
      evidence,
      oldTagsPropertyId: OLD_TAGS_PROPERTY,
      propertyMappings,
      optionMappings,
    });
    expect(rewritten.kind).toBe("rewritten_committed_create");
    if (rewritten.kind !== "rewritten_committed_create") {
      throw new Error("Expected rewritten create evidence");
    }
    expect(rewritten.evidence.requestJson).toBe(evidence.requestJson);
    expect(rewritten.evidence.requestHash).toBe(evidence.requestHash);
    expect(rewritten.evidence.resultJson).toBe(evidence.resultJson);
    const logical = JSON.parse(rewritten.evidence.requestJson) as {
      readonly version: number;
      readonly operation: { readonly tags: readonly string[] };
    };
    expect(logical).toMatchObject({
      version: 1,
      operation: { tags: ["Legacy Red", "Legacy Blue"] },
    });
    const receipt = parsePageLifecycleMutationReceipt(
      JSON.parse(rewritten.evidence.resultJson) as unknown,
    );
    expect(receipt.version).toBe(1);
    const intents = JSON.parse(rewritten.evidence.fieldIntentsJson) as readonly {
      readonly path: string;
      readonly operation: string;
    }[];
    expect(intents.at(-1)).toEqual({
      path: `data_source/source-1/properties/tags/options/${mappedOption("Legacy Red")}`,
      operation: "add",
    });
    const payload = JSON.parse(
      rewritten.evidence.changePayloadJson,
    ) as Readonly<Record<string, unknown>>;
    expect(payload.requestHash).toBe(rewritten.evidence.requestHash);
    expect(payload.createdTagOptionIds).toEqual([
      mappedOption("Legacy Red"),
    ]);
  });

  test("leaves rejected evidence literal and fails closed on intent divergence", () => {
    expect(
      rewriteCommittedPageLifecycleCreateEvidence({
        evidence: { ...createPageLifecycleEvidence(), outcome: "rejected" },
        oldTagsPropertyId: OLD_TAGS_PROPERTY,
        propertyMappings,
        optionMappings,
      }),
    ).toEqual({
      kind: "retained_rejected",
      reason: "rejected_evidence_is_literal",
    });
    expect(() =>
      rewriteCommittedPageLifecycleCreateEvidence({
        evidence: {
          ...createPageLifecycleEvidence(),
          fieldIntentsJson: stableStringifyBlockPropertyJson([
            { path: "blocks.page-created", operation: "create" },
          ]),
        },
        oldTagsPropertyId: OLD_TAGS_PROPERTY,
        propertyMappings,
        optionMappings,
      }),
    ).toThrow(/createdTagOptionIds and field intents diverge/u);
  });
});
