import type {
  ProjectionCoordinate,
  ProjectionDelivery,
  ProjectionEffect,
} from "../../shared/projection-stream";

export type ProjectionRepairReason =
  | "initial_subscription_gap"
  | "effect_gap"
  | "patch_unavailable"
  | "effect_requires_read"
  | "stream_reset"
  | "integrity_failure";

export interface ProjectionRepairRequest {
  readonly storeEpoch: string;
  readonly scopeKey: string;
  readonly minimumRevision: number;
  readonly minimumCommitSeq: number;
  readonly reason: ProjectionRepairReason;
}

export interface CausalProjectionRuntimeInput {
  readonly scopeKey: string;
  readonly schemaVersion: number;
  getCoordinate(): ProjectionCoordinate | null;
  apply(effect: ProjectionEffect): void;
  readAtLeast(request: ProjectionRepairRequest): Promise<void>;
  onIntegrityFailure?(error: Error): void;
}

interface BufferedEffect {
  readonly delivery: ProjectionDelivery;
}

const maxRepair = (
  left: ProjectionRepairRequest | null,
  right: ProjectionRepairRequest,
): ProjectionRepairRequest => {
  if (!left || left.storeEpoch !== right.storeEpoch) return right;
  return {
    ...right,
    minimumRevision: Math.max(left.minimumRevision, right.minimumRevision),
    minimumCommitSeq: Math.max(
      left.minimumCommitSeq,
      right.minimumCommitSeq,
    ),
  };
};

/**
 * Orders one exact projection scope by its Core-owned revision. Patches make
 * local commits visible synchronously; canonical reads only close gaps and
 * can never authorize an older snapshot to replace a newer coordinate.
 */
export class CausalProjectionRuntime {
  readonly #input: CausalProjectionRuntimeInput;
  readonly #buffer = new Map<number, BufferedEffect>();
  #repairing = false;
  #requiredRepair: ProjectionRepairRequest | null = null;
  #initialCheckpointObserved = false;

  constructor(input: CausalProjectionRuntimeInput) {
    this.#input = input;
  }

  accept(delivery: ProjectionDelivery): void {
    const effect = delivery.effect;
    if (
      effect.scope.canonical_key !== this.#input.scopeKey
      || effect.scope.schema_version !== this.#input.schemaVersion
    ) {
      return;
    }
    this.#acceptEffect(delivery);
  }

  observeInitialCheckpoint(input: {
    readonly storeEpoch: string;
    readonly scannedThroughCommitSeq: number;
  }): void {
    if (this.#initialCheckpointObserved) return;
    this.#initialCheckpointObserved = true;
    const current = this.#input.getCoordinate();
    if (
      current?.storeEpoch === input.storeEpoch
      && current.coveredCommitSeq >= input.scannedThroughCommitSeq
    ) {
      return;
    }
    this.#requestRepair({
      storeEpoch: input.storeEpoch,
      scopeKey: this.#input.scopeKey,
      minimumRevision: current?.revision ?? 0,
      minimumCommitSeq: input.scannedThroughCommitSeq,
      reason: "initial_subscription_gap",
    });
  }

  reset(input: {
    readonly storeEpoch: string;
    readonly commitSeq: number;
  }): void {
    this.#buffer.clear();
    this.#initialCheckpointObserved = true;
    this.#requestRepair({
      storeEpoch: input.storeEpoch,
      scopeKey: this.#input.scopeKey,
      minimumRevision: 0,
      minimumCommitSeq: input.commitSeq,
      reason: "stream_reset",
    });
  }

  diagnostics(): {
    readonly bufferedEffects: number;
    readonly repairing: boolean;
    readonly requiredRepair: ProjectionRepairRequest | null;
  } {
    return {
      bufferedEffects: this.#buffer.size,
      repairing: this.#repairing,
      requiredRepair: this.#requiredRepair,
    };
  }

  #acceptEffect(delivery: ProjectionDelivery): void {
    const effect = delivery.effect;
    const current = this.#input.getCoordinate();
    if (
      !current
      || current.storeEpoch !== delivery.storeEpoch
      || current.scopeKey !== effect.scope.canonical_key
      || current.schemaVersion !== effect.scope.schema_version
    ) {
      this.#bufferEffect(delivery);
      this.#requestRepairFor(delivery, "effect_gap");
      return;
    }
    if (current.revision > effect.resultRevision) return;
    if (current.revision === effect.resultRevision) {
      if (current.effectHash === effect.effectHash) return;
      this.#failIntegrity(
        `Projection revision ${effect.resultRevision} has conflicting effect hashes`,
        delivery,
      );
      return;
    }
    if (current.revision < effect.baseRevision) {
      this.#bufferEffect(delivery);
      this.#requestRepairFor(delivery, "effect_gap");
      return;
    }
    if (current.revision !== effect.baseRevision) {
      this.#failIntegrity("Projection effect does not continue its current revision", delivery);
      return;
    }
    if (!effect.patch) {
      this.#bufferEffect(delivery);
      this.#requestRepairFor(delivery, "patch_unavailable");
      return;
    }
    try {
      this.#input.apply(effect);
    } catch (error) {
      this.#failIntegrity(
        error instanceof Error ? error.message : "Projection patch reducer failed",
        delivery,
      );
      return;
    }
    const applied = this.#input.getCoordinate();
    if (
      !applied
      || applied.storeEpoch !== delivery.storeEpoch
      || applied.revision !== effect.resultRevision
      || applied.effectHash !== effect.effectHash
    ) {
      this.#failIntegrity("Projection reducer did not adopt the exact effect coordinate", delivery);
      return;
    }
    if (effect.requiresReadAtLeast) {
      this.#requestRepairFor(delivery, "effect_requires_read");
    }
    this.#drainBuffered();
  }

  #bufferEffect(delivery: ProjectionDelivery): void {
    const effect = delivery.effect;
    const existing = this.#buffer.get(effect.baseRevision);
    if (existing?.delivery.effect.effectHash === effect.effectHash) return;
    if (existing) {
      this.#failIntegrity(
        `Projection base revision ${effect.baseRevision} has multiple successors`,
        delivery,
      );
      return;
    }
    this.#buffer.set(effect.baseRevision, { delivery });
  }

  #drainBuffered(): void {
    while (true) {
      const current = this.#input.getCoordinate();
      if (!current) return;
      const buffered = this.#buffer.get(current.revision);
      if (!buffered) return;
      this.#buffer.delete(current.revision);
      const before = current.revision;
      this.#acceptEffect(buffered.delivery);
      if (this.#input.getCoordinate()?.revision === before) return;
    }
  }

  #requestRepairFor(
    delivery: ProjectionDelivery,
    reason: ProjectionRepairReason,
  ): void {
    this.#requestRepair({
      storeEpoch: delivery.storeEpoch,
      scopeKey: delivery.effect.scope.canonical_key,
      minimumRevision: delivery.effect.resultRevision,
      minimumCommitSeq: delivery.effect.coveredCommitSeq,
      reason,
    });
  }

  #requestRepair(request: ProjectionRepairRequest): void {
    this.#requiredRepair = maxRepair(this.#requiredRepair, request);
    if (this.#repairing) return;
    this.#repairing = true;
    queueMicrotask(() => void this.#drainRepairs());
  }

  async #drainRepairs(): Promise<void> {
    try {
      while (this.#requiredRepair) {
        const request = this.#requiredRepair;
        this.#requiredRepair = null;
        try {
          await this.#input.readAtLeast(request);
        } catch {
          this.#requiredRepair = maxRepair(this.#requiredRepair, request);
          return;
        }
        const current = this.#input.getCoordinate();
        if (
          !current
          || current.storeEpoch !== request.storeEpoch
          || current.scopeKey !== request.scopeKey
          || current.revision < request.minimumRevision
          || current.coveredCommitSeq < request.minimumCommitSeq
        ) {
          this.#requiredRepair = maxRepair(this.#requiredRepair, request);
          return;
        }
        this.#dropCoveredBuffer(current);
        this.#drainBuffered();
      }
    } finally {
      this.#repairing = false;
      if (this.#requiredRepair) {
        // Retry on a later task so a temporarily unavailable canonical read
        // cannot create a tight microtask loop.
        setTimeout(() => {
          if (this.#repairing || !this.#requiredRepair) return;
          this.#repairing = true;
          void this.#drainRepairs();
        }, 100);
      }
    }
  }

  #dropCoveredBuffer(current: ProjectionCoordinate): void {
    for (const [baseRevision, buffered] of this.#buffer) {
      const effect = buffered.delivery.effect;
      if (effect.resultRevision > current.revision) continue;
      if (
        effect.resultRevision === current.revision
        && current.effectHash !== effect.effectHash
      ) {
        this.#failIntegrity(
          `Canonical projection revision ${current.revision} conflicts with a buffered effect`,
          buffered.delivery,
        );
        return;
      }
      this.#buffer.delete(baseRevision);
    }
  }

  #failIntegrity(message: string, delivery: ProjectionDelivery): void {
    this.#buffer.clear();
    const error = new Error(message);
    this.#input.onIntegrityFailure?.(error);
    this.#requestRepairFor(delivery, "integrity_failure");
  }
}
