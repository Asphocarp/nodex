import type {
  CoreAuthorizedDeliveryPacket,
  CoreModuleEventPayload,
} from "../types";

interface CoreLocalCommitFixtureInput {
  readonly commitSeq: number;
  readonly payload?: CoreModuleEventPayload;
  readonly additionalPayloads?: readonly CoreModuleEventPayload[];
  readonly projectionImpact?: CoreAuthorizedDeliveryPacket["projection_impact"];
  readonly documentEffects?: CoreAuthorizedDeliveryPacket["document_effects"];
  readonly projectionEffects?: CoreAuthorizedDeliveryPacket["projection_effects"];
  readonly canonicalHash?: string;
  readonly storeEpoch?: string;
  readonly operationId?: string;
  readonly committedAt?: string;
  readonly resources?: {
    readonly block_ids: readonly string[];
    readonly document_ids: readonly string[];
    readonly database_ids: readonly string[];
  };
}

export const createCoreLocalCommitFixture = (
  input: CoreLocalCommitFixtureInput,
): CoreAuthorizedDeliveryPacket => {
  const storeEpoch = input.storeEpoch ?? "epoch-1";
  const operationId = input.operationId ?? `operation-${input.commitSeq}`;
  const committedAt = input.committedAt ?? "2026-08-06T00:00:00.000Z";
  const projectionImpact = input.projectionImpact ?? { kind: "none" };
  const payloads = [
    ...(input.payload === undefined ? [] : [input.payload]),
    ...(input.additionalPayloads ?? []),
  ];
  const manifestHash = input.canonicalHash
    ?? String(input.commitSeq).padStart(64, "0").slice(-64);
  const documentEffects = input.documentEffects ?? [];
  const projectionEffects = input.projectionEffects ?? [];
  const effects = payloads.map((payload, effectOrder) => ({
    semantic: {
      kind: "module_changed" as const,
      effect_kind: `${payload.module}.changed`,
      effect_order: effectOrder,
      module: payload.module,
      payload_hash: String(input.commitSeq * 10 + effectOrder)
        .padStart(64, "2")
        .slice(-64),
      projection_impact: projectionImpact,
      resources: input.resources ?? {
        block_ids: [],
        document_ids: [],
        database_ids: [],
      },
    },
    payload,
  }));
  return {
    packet_version: 1,
    manifest: {
      event_version: 5,
      identity: {
        commit_seq: input.commitSeq,
        manifest_hash: manifestHash,
        store_epoch: storeEpoch,
      },
      operation_id: operationId,
      committed_at: committedAt,
    },
    effects,
    document_effects: documentEffects,
    projection_effects: projectionEffects,
    revocations: [],
    projection_impact: projectionImpact,
    coverage: {
      semantic_effect_orders: effects.map((effect) => effect.semantic.effect_order),
      document_effect_orders: documentEffects.map((effect) => effect.reference.effect_order),
      inline_document_effect_orders: documentEffects
        .filter((effect) => effect.inline_update !== null && effect.inline_update !== undefined)
        .map((effect) => effect.reference.effect_order),
      projection_scope_keys: projectionEffects.map(
        (effect) => effect.scope.canonical_key,
      ),
    },
    packet_hash: String(input.commitSeq).padStart(64, "4").slice(-64),
  };
};
