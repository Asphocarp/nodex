import {
  DATABASE_MUTATION_CONTRACT_VERSION,
  DatabaseMutationContractError,
  parseDatabaseMutationRequest,
  parseDatabasePropertyConfig,
  parseGeneralDatabaseViewConfig,
  type DatabaseJsonValue,
  type DatabaseMutationOperation,
  type DatabaseMutationRequest,
  type DatabasePropertyOption,
  type DatabasePropertyValueType,
  type DatabaseViewFilterNode,
  type GeneralDatabaseViewConfig,
  type GeneralDatabaseViewKind,
} from "../../shared/database-kernel";
import {
  DATABASE_QUERY_CONTRACT_VERSION,
  type DatabaseReadSnapshot,
  type GeneralDatabaseManagement,
  type GeneralDatabaseMembershipState,
  type GeneralDatabaseDescriptor,
  type GeneralDatabasePropertyDefinition,
  type GeneralDatabaseViewDefinition,
} from "../../shared/database-query";

export type DatabaseManagementIntentErrorCode =
  | "invalid_intent"
  | "authority_scope_mismatch"
  | "database_not_found"
  | "database_authority_invalid"
  | "property_not_found"
  | "property_identity_collision"
  | "property_anchor_not_found"
  | "property_type_invalid"
  | "option_not_found"
  | "option_identity_collision"
  | "option_anchor_not_found"
  | "view_not_found"
  | "view_identity_collision"
  | "view_anchor_not_found"
  | "view_property_not_found"
  | "card_not_found"
  | "card_authority_invalid"
  | "membership_already_exists"
  | "membership_not_found"
  | "membership_target_unchanged"
  | "membership_anchor_not_found"
  | "membership_group_invalid";

export class DatabaseManagementIntentError extends Error {
  constructor(
    readonly code: DatabaseManagementIntentErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DatabaseManagementIntentError";
  }
}

export interface DatabaseManagementRequestContext {
  /** Generated once by the caller and retained unchanged for every retry. */
  readonly operationId: string;
  readonly projectId: string;
  readonly storeEpoch: string;
  readonly clientSessionId?: string;
  readonly actor: Readonly<Record<string, DatabaseJsonValue>>;
}

export interface DatabasePropertyDraft {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly valueType: DatabasePropertyValueType;
  readonly config: Readonly<Record<string, DatabaseJsonValue>>;
}

export interface DatabaseViewDraft {
  readonly id: string;
  readonly name: string;
  readonly kind: GeneralDatabaseViewKind;
  readonly config: GeneralDatabaseViewConfig;
  readonly isPrimary: boolean;
}

interface DescriptorAuthority {
  readonly descriptor: DatabaseReadSnapshot<GeneralDatabaseDescriptor>;
}

export type DatabaseManagementIntent =
  | {
      readonly kind: "create_database";
      readonly databaseBlockId: string;
      readonly name: string;
      readonly initialView: Omit<DatabaseViewDraft, "isPrimary">;
      readonly beforeBlockId?: string;
    }
  | (DescriptorAuthority & {
      readonly kind: "put_property";
      readonly mode: "create" | "update";
      readonly property: DatabasePropertyDraft;
      /** Undefined preserves an update's current placement; null appends. */
      readonly beforePropertyId?: string | null;
    })
  | (DescriptorAuthority & {
      readonly kind: "delete_property";
      readonly propertyId: string;
    })
  | (DescriptorAuthority & {
      readonly kind: "put_property_option";
      readonly mode: "create" | "update";
      readonly propertyId: string;
      readonly option: DatabasePropertyOption;
      /** Undefined preserves an update's current placement; null appends. */
      readonly beforeOptionId?: string | null;
    })
  | (DescriptorAuthority & {
      readonly kind: "delete_property_option";
      readonly propertyId: string;
      readonly optionId: string;
    })
  | (DescriptorAuthority & {
      readonly kind: "put_view";
      readonly mode: "create" | "update";
      readonly view: DatabaseViewDraft;
      /**
       * A mounted editor's captured revision. Supplying it prevents a later
       * authority read from silently upgrading a stale whole-View draft.
       */
      readonly expectedRevision?: number;
      /** Undefined preserves an update's current placement; null appends. */
      readonly beforeViewId?: string | null;
    })
  | (DescriptorAuthority & {
      readonly kind: "delete_view";
      readonly viewId: string;
    })
  | {
      readonly kind: "set_membership";
      readonly authority: DatabaseReadSnapshot<GeneralDatabaseManagement>;
      readonly cardBlockId: string;
      readonly target: null | {
        readonly databaseBlockId: string;
        readonly membershipId: string;
        readonly viewId: string;
        /** A new membership has no grouping value, so this must be null. */
        readonly groupKey?: string | null;
        readonly beforeCardBlockId?: string;
      };
    };

const fail = (
  code: DatabaseManagementIntentErrorCode,
  message: string,
): never => {
  throw new DatabaseManagementIntentError(code, message);
};

const assertUniqueIds = (ids: readonly string[], label: string): void => {
  if (new Set(ids).size === ids.length) return;
  fail("database_authority_invalid", `${label} contains duplicate identities`);
};

const readDescriptorAuthority = (
  context: DatabaseManagementRequestContext,
  snapshot: DatabaseReadSnapshot<GeneralDatabaseDescriptor>,
): GeneralDatabaseDescriptor => {
  if (
    snapshot.version !== DATABASE_QUERY_CONTRACT_VERSION ||
    snapshot.projectId !== context.projectId ||
    snapshot.storeEpoch !== context.storeEpoch
  ) {
    return fail(
      "authority_scope_mismatch",
      "Database descriptor does not belong to the request Project and store epoch",
    );
  }
  const descriptor = snapshot.value;
  if (!descriptor) {
    return fail("database_not_found", "Database descriptor is unavailable");
  }
  const databaseBlockId = descriptor.database.blockId;
  if (descriptor.database.projectId !== context.projectId) {
    return fail(
      "authority_scope_mismatch",
      `Database ${databaseBlockId} belongs to another Project`,
    );
  }
  if (
    descriptor.properties.some(
      (property) => property.databaseBlockId !== databaseBlockId,
    ) ||
    descriptor.views.some(
      (view) =>
        view.databaseBlockId !== databaseBlockId ||
        view.projectId !== context.projectId,
    )
  ) {
    return fail(
      "database_authority_invalid",
      `Database ${databaseBlockId} contains cross-Database descriptor records`,
    );
  }
  assertUniqueIds(
    descriptor.properties.map((property) => property.id),
    `Database ${databaseBlockId} properties`,
  );
  assertUniqueIds(
    descriptor.views.map((view) => view.id),
    `Database ${databaseBlockId} Views`,
  );
  return descriptor;
};

const readManagementAuthority = (
  context: DatabaseManagementRequestContext,
  snapshot: DatabaseReadSnapshot<GeneralDatabaseManagement>,
): GeneralDatabaseManagement => {
  if (
    snapshot.version !== DATABASE_QUERY_CONTRACT_VERSION ||
    snapshot.projectId !== context.projectId ||
    snapshot.storeEpoch !== context.storeEpoch
  ) {
    return fail(
      "authority_scope_mismatch",
      "Database management authority does not belong to the request Project and store epoch",
    );
  }
  const authority = snapshot.value;
  if (!authority) {
    return fail(
      "database_not_found",
      "Database management authority is unavailable",
    );
  }
  const databaseBlockIds = authority.catalog.databases.map(
    (descriptor) => descriptor.database.blockId,
  );
  assertUniqueIds(databaseBlockIds, "Database management catalog");
  const databaseIds = new Set(databaseBlockIds);
  for (const descriptor of authority.catalog.databases) {
    readDescriptorAuthority(context, { ...snapshot, value: descriptor });
  }
  assertUniqueIds(
    authority.cards.map((state) => state.card.blockId),
    "Database management Cards",
  );
  assertUniqueIds(
    authority.cards.flatMap((state) =>
      state.membership ? [state.membership.id] : [],
    ),
    "Database management memberships",
  );
  for (const state of authority.cards) {
    assertCardIdentity(context, state.card);
    if (
      state.membership &&
      (state.membership.cardBlockId !== state.card.blockId ||
        !databaseIds.has(state.membership.databaseBlockId))
    ) {
      return fail(
        "database_authority_invalid",
        `Card ${state.card.blockId} contains an invalid owning membership`,
      );
    }
    const viewIds = new Set<string>();
    for (const position of state.positions) {
      if (viewIds.has(position.viewId)) {
        return fail(
          "database_authority_invalid",
          `Card ${state.card.blockId} contains duplicate View positions`,
        );
      }
      viewIds.add(position.viewId);
      const descriptor = authority.catalog.databases.find(
        (candidate) =>
          candidate.views.some(
            (view) =>
              view.id === position.viewId && view.lifecycle === "active",
          ),
      );
      if (
        !state.membership ||
        descriptor?.database.blockId !== state.membership.databaseBlockId
      ) {
        return fail(
          "database_authority_invalid",
          `Card ${state.card.blockId} contains a position outside its owning Database`,
        );
      }
    }
  }
  return authority;
};

const activeProperty = (
  descriptor: GeneralDatabaseDescriptor,
  propertyId: string,
): GeneralDatabasePropertyDefinition => {
  const property = descriptor.properties.find(
    (candidate) =>
      candidate.id === propertyId && candidate.lifecycle === "active",
  );
  if (property) return property;
  return fail(
    "property_not_found",
    `Active property is not in Database ${descriptor.database.blockId}: ${propertyId}`,
  );
};

const activeView = (
  descriptor: GeneralDatabaseDescriptor,
  viewId: string,
): GeneralDatabaseViewDefinition => {
  const view = descriptor.views.find(
    (candidate) => candidate.id === viewId && candidate.lifecycle === "active",
  );
  if (view) return view;
  return fail(
    "view_not_found",
    `Active View is not in Database ${descriptor.database.blockId}: ${viewId}`,
  );
};

const logicalBeforeId = (input: {
  readonly orderedIds: readonly string[];
  readonly targetId: string;
  readonly mode: "create" | "update";
  readonly requested: string | null | undefined;
  readonly missingCode:
    | "property_anchor_not_found"
    | "option_anchor_not_found"
    | "view_anchor_not_found";
  readonly label: string;
}): string | undefined => {
  if (input.requested === null) return undefined;
  if (input.requested !== undefined) {
    if (
      input.requested === input.targetId ||
      !input.orderedIds.includes(input.requested)
    ) {
      return fail(
        input.missingCode,
        `${input.label} anchor is not an external active identity: ${input.requested}`,
      );
    }
    return input.requested;
  }
  if (input.mode === "create") return undefined;
  const currentIndex = input.orderedIds.indexOf(input.targetId);
  if (currentIndex < 0) {
    return fail(
      input.missingCode,
      `${input.label} update target is absent from its ordered authority`,
    );
  }
  return input.orderedIds[currentIndex + 1];
};

const filterPropertyIds = (
  filter: DatabaseViewFilterNode,
): readonly string[] => {
  if (filter.kind === "clause") return [filter.propertyId];
  return filter.children.flatMap(filterPropertyIds);
};

const viewPropertyIds = (
  config: GeneralDatabaseViewConfig,
): readonly string[] => [
  ...filterPropertyIds(config.filter),
  ...config.sort.flatMap((sort) =>
    sort.field.kind === "property" ? [sort.field.propertyId] : [],
  ),
  ...(config.group ? [config.group.propertyId] : []),
  ...config.display.propertyIds,
];

const normalizeViewConfig = (
  config: GeneralDatabaseViewConfig,
  descriptor: GeneralDatabaseDescriptor | null,
): GeneralDatabaseViewConfig => {
  const normalized = parseGeneralDatabaseViewConfig(config);
  const activePropertyIds = new Set(
    descriptor?.properties
      .filter((property) => property.lifecycle === "active")
      .map((property) => property.id) ?? [],
  );
  const missing = viewPropertyIds(normalized).find(
    (propertyId) => !activePropertyIds.has(propertyId),
  );
  if (missing === undefined) return normalized;
  return fail(
    "view_property_not_found",
    `Database View config references property outside its active Database schema: ${missing}`,
  );
};

const propertyOptions = (
  property: GeneralDatabasePropertyDefinition,
): readonly DatabasePropertyOption[] => {
  if (
    property.valueType !== "select" &&
    property.valueType !== "multi_select"
  ) {
    return fail(
      "property_type_invalid",
      `Property ${property.id} does not own selectable options`,
    );
  }
  const config = parseDatabasePropertyConfig(
    property.valueType,
    property.config,
  );
  const values = config.options as readonly DatabaseJsonValue[];
  return values.map((value) => {
    const record = value as Readonly<Record<string, DatabaseJsonValue>>;
    return {
      id: record.id as string,
      name: record.name as string,
      ...(record.color === undefined ? {} : { color: record.color as string }),
    };
  });
};

const configWithOptions = (
  property: GeneralDatabasePropertyDefinition,
  options: readonly DatabasePropertyOption[],
): Readonly<Record<string, DatabaseJsonValue>> =>
  parseDatabasePropertyConfig(property.valueType, {
    options: options.map((option) => ({
      id: option.id,
      name: option.name,
      ...(option.color === undefined ? {} : { color: option.color }),
    })),
  });

const propertyPlacement = (
  descriptor: GeneralDatabaseDescriptor,
  propertyId: string,
): string | undefined =>
  logicalBeforeId({
    orderedIds: descriptor.properties
      .filter((property) => property.lifecycle === "active")
      .map((property) => property.id),
    targetId: propertyId,
    mode: "update",
    requested: undefined,
    missingCode: "property_anchor_not_found",
    label: "Property",
  });

const putPropertyOperation = (input: {
  readonly descriptor: GeneralDatabaseDescriptor;
  readonly property: GeneralDatabasePropertyDefinition;
  readonly config: Readonly<Record<string, DatabaseJsonValue>>;
}): DatabaseMutationOperation => {
  const beforePropertyId = propertyPlacement(
    input.descriptor,
    input.property.id,
  );
  return {
    kind: "put_property",
    databaseBlockId: input.descriptor.database.blockId,
    propertyId: input.property.id,
    expectedDatabaseSchemaRevision: input.descriptor.database.schemaRevision,
    expectedPropertyRevision: input.property.revision,
    key: input.property.key,
    name: input.property.name,
    valueType: input.property.valueType,
    config: input.config,
    ...(beforePropertyId === undefined ? {} : { beforePropertyId }),
  };
};

const findMembershipState = (
  authority: GeneralDatabaseManagement,
  cardBlockId: string,
): GeneralDatabaseMembershipState => {
  const state = authority.cards.find(
    (candidate) => candidate.card.blockId === cardBlockId,
  );
  if (state) return state;
  return fail(
    "card_not_found",
    `Active Card is absent from Database management authority: ${cardBlockId}`,
  );
};

const readNewMembershipGroup = (groupKey: string | null | undefined): null => {
  if (groupKey === undefined || groupKey === null) return null;
  return fail(
    "membership_group_invalid",
    "A new membership has no grouping property value and must enter the null group",
  );
};

const membershipAnchor = (input: {
  readonly authority: GeneralDatabaseManagement;
  readonly databaseBlockId: string;
  readonly viewId: string;
  readonly movingCardBlockId: string;
  readonly groupKey: string | null;
  readonly beforeCardBlockId: string | undefined;
}): string | undefined => {
  if (input.beforeCardBlockId === undefined) return undefined;
  if (input.beforeCardBlockId === input.movingCardBlockId) {
    return fail(
      "membership_anchor_not_found",
      "Membership position anchor must be external to the moving Card",
    );
  }
  const anchor = input.authority.cards.find(
    (state) => state.card.blockId === input.beforeCardBlockId,
  );
  const position = anchor?.positions.find(
    (candidate) => candidate.viewId === input.viewId,
  );
  if (!anchor?.membership ||
    anchor.membership.databaseBlockId !== input.databaseBlockId ||
    !position || position.groupKey !== input.groupKey) {
    return fail(
      "membership_anchor_not_found",
      `Card ${input.beforeCardBlockId} is not an explicit position anchor in the target View group`,
    );
  }
  return input.beforeCardBlockId;
};

function assertCardIdentity(
  context: DatabaseManagementRequestContext,
  card: Pick<
    GeneralDatabaseMembershipState["card"],
    "blockId" | "projectId" | "lifecycle"
  >,
): void {
  if (card.projectId !== context.projectId) {
    fail(
      "card_authority_invalid",
      `Card ${card.blockId} belongs to another Project`,
    );
  }
  if (card.lifecycle === "active") return;
  fail("card_not_found", `Card ${card.blockId} is not active`);
}

const compileIntent = (
  context: DatabaseManagementRequestContext,
  intent: DatabaseManagementIntent,
): DatabaseMutationOperation => {
  switch (intent.kind) {
    case "create_database": {
      const config = normalizeViewConfig(intent.initialView.config, null);
      return {
        kind: "create_database",
        databaseBlockId: intent.databaseBlockId,
        name: intent.name,
        isPrimary: false,
        initialView: {
          viewId: intent.initialView.id,
          name: intent.initialView.name,
          viewKind: intent.initialView.kind,
          config,
        },
        ...(intent.beforeBlockId === undefined
          ? {}
          : { beforeBlockId: intent.beforeBlockId }),
      };
    }
    case "put_property": {
      const descriptor = readDescriptorAuthority(context, intent.descriptor);
      const existing = descriptor.properties.find(
        (property) => property.id === intent.property.id,
      );
      if (intent.mode === "create" && existing) {
        return fail(
          "property_identity_collision",
          `Property identity is already reserved: ${intent.property.id}`,
        );
      }
      if (
        intent.mode === "update" &&
        (!existing || existing.lifecycle !== "active")
      ) {
        return fail(
          "property_not_found",
          `Active property is unavailable for update: ${intent.property.id}`,
        );
      }
      const beforePropertyId = logicalBeforeId({
        orderedIds: descriptor.properties
          .filter((property) => property.lifecycle === "active")
          .map((property) => property.id),
        targetId: intent.property.id,
        mode: intent.mode,
        requested: intent.beforePropertyId,
        missingCode: "property_anchor_not_found",
        label: "Property",
      });
      return {
        kind: "put_property",
        databaseBlockId: descriptor.database.blockId,
        propertyId: intent.property.id,
        expectedDatabaseSchemaRevision: descriptor.database.schemaRevision,
        expectedPropertyRevision:
          intent.mode === "create" ? 0 : existing!.revision,
        key: intent.property.key,
        name: intent.property.name,
        valueType: intent.property.valueType,
        config: parseDatabasePropertyConfig(
          intent.property.valueType,
          intent.property.config,
        ),
        ...(beforePropertyId === undefined ? {} : { beforePropertyId }),
      };
    }
    case "delete_property": {
      const descriptor = readDescriptorAuthority(context, intent.descriptor);
      const property = activeProperty(descriptor, intent.propertyId);
      return {
        kind: "delete_property",
        databaseBlockId: descriptor.database.blockId,
        propertyId: property.id,
        expectedDatabaseSchemaRevision: descriptor.database.schemaRevision,
        expectedPropertyRevision: property.revision,
      };
    }
    case "put_property_option": {
      const descriptor = readDescriptorAuthority(context, intent.descriptor);
      const property = activeProperty(descriptor, intent.propertyId);
      const options = propertyOptions(property);
      const existing = options.find((option) => option.id === intent.option.id);
      if (intent.mode === "create" && existing) {
        return fail(
          "option_identity_collision",
          `Property option identity is already reserved: ${intent.option.id}`,
        );
      }
      if (intent.mode === "update" && !existing) {
        return fail(
          "option_not_found",
          `Property option is unavailable for update: ${intent.option.id}`,
        );
      }
      const beforeOptionId = logicalBeforeId({
        orderedIds: options.map((option) => option.id),
        targetId: intent.option.id,
        mode: intent.mode,
        requested: intent.beforeOptionId,
        missingCode: "option_anchor_not_found",
        label: "Property option",
      });
      const nextOptions = options.filter(
        (option) => option.id !== intent.option.id,
      );
      const index =
        beforeOptionId === undefined
          ? nextOptions.length
          : nextOptions.findIndex((option) => option.id === beforeOptionId);
      nextOptions.splice(index, 0, intent.option);
      return putPropertyOperation({
        descriptor,
        property,
        config: configWithOptions(property, nextOptions),
      });
    }
    case "delete_property_option": {
      const descriptor = readDescriptorAuthority(context, intent.descriptor);
      const property = activeProperty(descriptor, intent.propertyId);
      const options = propertyOptions(property);
      if (!options.some((option) => option.id === intent.optionId)) {
        return fail(
          "option_not_found",
          `Property option is unavailable for deletion: ${intent.optionId}`,
        );
      }
      return putPropertyOperation({
        descriptor,
        property,
        config: configWithOptions(
          property,
          options.filter((option) => option.id !== intent.optionId),
        ),
      });
    }
    case "put_view": {
      const descriptor = readDescriptorAuthority(context, intent.descriptor);
      const existing = descriptor.views.find(
        (view) => view.id === intent.view.id,
      );
      if (intent.mode === "create" && existing) {
        return fail(
          "view_identity_collision",
          `Database View identity is already reserved: ${intent.view.id}`,
        );
      }
      if (
        intent.mode === "update" &&
        (!existing || existing.lifecycle !== "active")
      ) {
        return fail(
          "view_not_found",
          `Active Database View is unavailable for update: ${intent.view.id}`,
        );
      }
      const beforeViewId = logicalBeforeId({
        orderedIds: descriptor.views
          .filter((view) => view.lifecycle === "active")
          .map((view) => view.id),
        targetId: intent.view.id,
        mode: intent.mode,
        requested: intent.beforeViewId,
        missingCode: "view_anchor_not_found",
        label: "Database View",
      });
      return {
        kind: "put_view",
        databaseBlockId: descriptor.database.blockId,
        viewId: intent.view.id,
        expectedRevision:
          intent.mode === "create"
            ? 0
            : intent.expectedRevision ?? existing!.revision,
        name: intent.view.name,
        viewKind: intent.view.kind,
        config: normalizeViewConfig(intent.view.config, descriptor),
        isPrimary: intent.view.isPrimary,
        ...(beforeViewId === undefined ? {} : { beforeViewId }),
      };
    }
    case "delete_view": {
      const descriptor = readDescriptorAuthority(context, intent.descriptor);
      const view = activeView(descriptor, intent.viewId);
      return {
        kind: "delete_view",
        databaseBlockId: descriptor.database.blockId,
        viewId: view.id,
        expectedRevision: view.revision,
      };
    }
    case "set_membership": {
      const authority = readManagementAuthority(context, intent.authority);
      const state = findMembershipState(authority, intent.cardBlockId);
      assertCardIdentity(context, state.card);
      const expectedMembership = state.membership
        ? {
            membershipId: state.membership.id,
            revision: state.membership.revision,
          }
        : null;
      if (intent.target === null) {
        if (!state.membership) {
          return fail(
            "membership_not_found",
            `Card ${intent.cardBlockId} has no owning Database membership`,
          );
        }
        return {
          kind: "transfer_membership",
          cardBlockId: state.card.blockId,
          expectedMembership,
          target: null,
        };
      }
      const target = intent.target;

      if (state.membership?.databaseBlockId === target.databaseBlockId) {
        return fail(
          "membership_target_unchanged",
          `Card ${intent.cardBlockId} already belongs to Database ${target.databaseBlockId}`,
        );
      }
      if (
        authority.cards.some(
          (candidate) => candidate.membership?.id === target.membershipId,
        )
      ) {
        return fail(
          "membership_already_exists",
          `Membership identity is already active: ${target.membershipId}`,
        );
      }
      const descriptor = authority.catalog.databases.find(
        (candidate) => candidate.database.blockId === target.databaseBlockId,
      );
      if (!descriptor) {
        return fail(
          "database_not_found",
          `Target Database is absent from management authority: ${target.databaseBlockId}`,
        );
      }
      const view = activeView(descriptor, target.viewId);
      const groupKey = readNewMembershipGroup(target.groupKey);
      const beforeCardBlockId = membershipAnchor({
        authority,
        databaseBlockId: descriptor.database.blockId,
        viewId: view.id,
        movingCardBlockId: intent.cardBlockId,
        groupKey,
        beforeCardBlockId: target.beforeCardBlockId,
      });
      return {
        kind: "transfer_membership",
        cardBlockId: state.card.blockId,
        expectedMembership,
        target: {
          databaseBlockId: descriptor.database.blockId,
          membershipId: target.membershipId,
          viewId: view.id,
          groupKey,
          ...(beforeCardBlockId === undefined ? {} : { beforeCardBlockId }),
        },
      };
    }
  }
};

/**
 * Compile one management action into the existing General Database kernel
 * request. The compiler derives every CAS revision from read authority and
 * emits logical anchors only; SQLite remains the sole rank allocator.
 */
export const compileDatabaseManagementRequest = (input: {
  readonly context: DatabaseManagementRequestContext;
  readonly intent: DatabaseManagementIntent;
}): DatabaseMutationRequest => {
  try {
    const operation = compileIntent(input.context, input.intent);
    return parseDatabaseMutationRequest({
      version: DATABASE_MUTATION_CONTRACT_VERSION,
      operationId: input.context.operationId,
      projectId: input.context.projectId,
      storeEpoch: input.context.storeEpoch,
      ...(input.context.clientSessionId === undefined
        ? {}
        : { clientSessionId: input.context.clientSessionId }),
      actor: input.context.actor,
      operations: [operation],
    });
  } catch (error) {
    if (error instanceof DatabaseManagementIntentError) throw error;
    if (error instanceof DatabaseMutationContractError) {
      return fail("invalid_intent", error.message);
    }
    throw error;
  }
};
