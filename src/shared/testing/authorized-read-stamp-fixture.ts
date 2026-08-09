import { sha256 } from "@noble/hashes/sha2.js";

import type {
  AuthorityResource,
  AuthorizedReadStamp,
} from "../authorized-read-stamp";
import { canonicalizeAuthorityResources } from "../authorized-read-stamp";
import type { DeliveryAddress } from "../recipient-delivery";

const bytesToHex = (bytes: Uint8Array): string =>
  [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");

export const authorizedReadStampFixture = (input: {
  readonly deliveryAddress: DeliveryAddress;
  readonly subject: AuthorityResource;
  readonly storeEpoch?: string;
  readonly commitSeq?: number;
  readonly requestDependencies?: readonly AuthorityResource[];
  readonly authorizationDependencies?: readonly AuthorityResource[];
}): AuthorizedReadStamp => {
  const payload = {
    store_epoch: input.storeEpoch ?? "epoch-1",
    delivery_address: input.deliveryAddress,
    authorization_scope: input.deliveryAddress,
    subject: input.subject,
    request_dependencies: canonicalizeAuthorityResources(
      input.requestDependencies ?? [input.subject],
    ),
    authorization_dependencies: canonicalizeAuthorityResources(
      input.authorizationDependencies ?? [input.subject],
    ),
    covered_commit_seq: input.commitSeq ?? 1,
  } as const;
  return {
    ...payload,
    stamp_hash: bytesToHex(sha256(new TextEncoder().encode(JSON.stringify({
      hash_version: 1,
      ...payload,
    })))),
  };
};
