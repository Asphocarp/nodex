import type { AuthorizedDeliveryPacket } from "../../shared/authorized-delivery-packet";
import {
  deliveryAddressKey,
  deliveryAddressProjectionScope,
  type AddressResetReason,
  type AuthorizedRecipientLease,
  type DeliveryAddress,
} from "../../shared/recipient-delivery";
import type { ProjectionScope } from "../../shared/projection-stream";
import {
  RecipientDeliveryRouter,
  type FanoutReport,
} from "./recipient-delivery-router";

interface AudienceSender {
  readonly id: number;
  isDestroyed(): boolean;
  isLoadingMainFrame?(): boolean;
  send(channel: string, ...args: unknown[]): void;
}

interface RecipientHandle {
  readonly publish: (packet: AuthorizedDeliveryPacket) => FanoutReport;
  readonly reset: (
    floor: { readonly storeEpoch: string; readonly commitSeq: number },
    reason: AddressResetReason,
  ) => FanoutReport;
  readonly release: () => void;
}

interface AudienceSubscription {
  readonly sender: AudienceSender;
  readonly address: DeliveryAddress;
  lease: AuthorizedRecipientLease | null;
  recipient: RecipientHandle | null;
}

interface CurrentLeaseGrant {
  readonly lease: AuthorizedRecipientLease;
  readonly floor: { readonly storeEpoch: string; readonly commitSeq: number };
}

const subscriptionKey = (senderId: number, address: DeliveryAddress): string =>
  `${senderId}:${deliveryAddressKey(address)}`;

const validAddress = (address: DeliveryAddress): boolean => {
  if (!address.library_id || address.library_id !== address.library_id.trim()) {
    return false;
  }
  if (address.kind === "library") return true;
  if (address.kind === "project") {
    return Boolean(address.project_id && address.project_id === address.project_id.trim());
  }
  return Boolean(
    address.document_id
    && address.document_id === address.document_id.trim()
    && (
      address.project_id === null
      || address.project_id === undefined
      || address.project_id === address.project_id.trim()
    ),
  );
};

/**
 * Authenticated Host broker for renderer audiences. Renderers request only a
 * logical address; the Core barrier supplies the immutable authorization
 * scope and lease used by RecipientDeliveryRouter.
 */
export class LocalCommitAudienceBroker {
  readonly #router: RecipientDeliveryRouter;
  readonly #onScopesChanged: (scopes: readonly ProjectionScope[]) => void;
  readonly #resolveLibraryId: () => string | null;
  readonly #subscriptions = new Map<string, AudienceSubscription>();
  readonly #leaseGrants = new Map<string, CurrentLeaseGrant>();

  constructor(input: {
    readonly router: RecipientDeliveryRouter;
    readonly onScopesChanged: (scopes: readonly ProjectionScope[]) => void;
    readonly resolveLibraryId: () => string | null;
  }) {
    this.#router = input.router;
    this.#onScopesChanged = input.onScopesChanged;
    this.#resolveLibraryId = input.resolveLibraryId;
  }

  subscribe(sender: AudienceSender, address: DeliveryAddress): () => void {
    const libraryId = this.#resolveLibraryId();
    if (
      !libraryId
      || address.library_id !== libraryId
      || !validAddress(address)
      || !deliveryAddressProjectionScope(address)
    ) {
      throw new TypeError("Local commit audience address is invalid");
    }
    const key = subscriptionKey(sender.id, address);
    this.#release(this.#subscriptions.get(key));
    const state: AudienceSubscription = {
      sender,
      address,
      lease: null,
      recipient: null,
    };
    this.#subscriptions.set(key, state);
    if (this.#scopes().length > 200) {
      this.#subscriptions.delete(key);
      throw new RangeError("Local commit audience supports at most 200 addresses");
    }
    const grant = this.#leaseGrants.get(deliveryAddressKey(address));
    if (grant) {
      state.lease = grant.lease;
      state.recipient = this.#router.register(sender, grant.lease);
      state.recipient.reset(grant.floor, "stream_gap");
    }
    this.#notifyScopes();
    return () => {
      if (this.#subscriptions.get(key) !== state) return;
      this.#subscriptions.delete(key);
      this.#release(state);
      this.#pruneLeaseGrants();
      this.#notifyScopes();
    };
  }

  installLeases(
    leases: readonly AuthorizedRecipientLease[],
    floor: { readonly storeEpoch: string; readonly commitSeq: number },
    resetAddresses: readonly DeliveryAddress[],
    reason: AddressResetReason,
  ): void {
    if (leases.length > 200) {
      throw new RangeError("Core recipient barrier exceeds the audience bound");
    }
    const byAddress = new Map(
      leases.map((lease) => [deliveryAddressKey(lease.delivery_address), lease]),
    );
    this.#leaseGrants.clear();
    for (const [addressKey, lease] of byAddress) {
      this.#leaseGrants.set(addressKey, { lease, floor });
    }
    const resetKeys = new Set(resetAddresses.map(deliveryAddressKey));
    for (const state of this.#subscriptions.values()) {
      const addressKey = deliveryAddressKey(state.address);
      const lease = byAddress.get(addressKey);
      if (!lease) {
        this.#release(state);
        continue;
      }
      if (state.lease?.lease_id !== lease.lease_id) {
        state.recipient?.release();
        state.lease = lease;
        state.recipient = this.#router.register(state.sender, lease);
      }
      if (resetKeys.has(addressKey)) state.recipient?.reset(floor, reason);
    }
  }

  publish(packet: AuthorizedDeliveryPacket): FanoutReport {
    const addressKey = deliveryAddressKey(packet.delivery_address);
    let recipients = 0;
    let sent = 0;
    let fenced = 0;
    let released = 0;
    for (const state of this.#subscriptions.values()) {
      if (deliveryAddressKey(state.address) !== addressKey || !state.recipient) {
        continue;
      }
      const delivery = state.recipient.publish(packet);
      recipients += delivery.recipients;
      sent += delivery.sent;
      fenced += delivery.fenced;
      released += delivery.released;
    }
    return { recipients, sent, fenced, released };
  }

  reset(
    floor: { readonly storeEpoch: string; readonly commitSeq: number },
    reason: AddressResetReason,
    addresses?: readonly DeliveryAddress[],
  ): void {
    const allowed = addresses
      ? new Set(addresses.map(deliveryAddressKey))
      : null;
    for (const state of this.#subscriptions.values()) {
      if (allowed && !allowed.has(deliveryAddressKey(state.address))) continue;
      state.recipient?.reset(floor, reason);
    }
  }

  releaseSender(senderId: number): void {
    for (const [key, state] of this.#subscriptions) {
      if (state.sender.id !== senderId) continue;
      this.#subscriptions.delete(key);
      this.#release(state);
    }
    this.#pruneLeaseGrants();
    this.#router.releaseSender(senderId);
    this.#notifyScopes();
  }

  dispose(): void {
    for (const state of this.#subscriptions.values()) this.#release(state);
    this.#subscriptions.clear();
    this.#leaseGrants.clear();
    this.#router.dispose();
    this.#notifyScopes();
  }

  diagnostics(): {
    readonly subscriptions: number;
    readonly leasedSubscriptions: number;
    readonly addresses: number;
  } {
    return {
      subscriptions: this.#subscriptions.size,
      leasedSubscriptions: [...this.#subscriptions.values()]
        .filter((state) => state.recipient !== null).length,
      addresses: this.#scopes().length,
    };
  }

  refreshScopes(): void {
    this.#notifyScopes();
  }

  #scopes(): readonly ProjectionScope[] {
    const scopes = new Map<string, ProjectionScope>();
    for (const state of this.#subscriptions.values()) {
      const scope = deliveryAddressProjectionScope(state.address);
      if (!scope) continue;
      scopes.set(deliveryAddressKey(state.address), scope);
    }
    return [...scopes.values()];
  }

  #notifyScopes(): void {
    this.#onScopesChanged(this.#scopes());
  }

  #pruneLeaseGrants(): void {
    const activeAddresses = new Set(
      [...this.#subscriptions.values()].map((state) =>
        deliveryAddressKey(state.address)
      ),
    );
    for (const addressKey of this.#leaseGrants.keys()) {
      if (!activeAddresses.has(addressKey)) this.#leaseGrants.delete(addressKey);
    }
  }

  #release(state: AudienceSubscription | undefined): void {
    state?.recipient?.release();
    if (!state) return;
    state.recipient = null;
    state.lease = null;
  }
}
