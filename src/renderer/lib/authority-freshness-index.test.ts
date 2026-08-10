import { describe, expect, test, vi } from "vitest";

import type {
  AuthorityResource,
  AuthorizedReadStamp,
} from "../../shared/authorized-read-stamp";
import { authorizedReadStampHash } from "../../shared/authorized-read-stamp";
import type { DeliveryAddress } from "../../shared/recipient-delivery";
import {
  AuthorityFreshnessCapacityError,
  AuthorityFreshnessIndex,
  StaleAuthorizedReadError,
} from "./authority-freshness-index";

const address: DeliveryAddress = {
  kind: "project",
  library_id: "library-1",
  project_id: "project-1",
};
const page = (pageId: string): AuthorityResource => ({
  kind: "page",
  page_id: pageId,
});
const database = (databaseId: string): AuthorityResource => ({
  kind: "database",
  database_id: databaseId,
});

const stamp = async (input: {
  readonly subject: AuthorityResource;
  readonly dependencies?: readonly AuthorityResource[];
  readonly commitSeq: number;
  readonly storeEpoch?: string;
}): Promise<AuthorizedReadStamp> => {
  const payload = {
    store_epoch: input.storeEpoch ?? "epoch-1",
    delivery_address: address,
    authorization_scope: address,
    subject: input.subject,
    request_dependencies: [input.subject],
    authorization_dependencies: input.dependencies ?? [input.subject],
    covered_commit_seq: input.commitSeq,
  } as const;
  return {
    ...payload,
    stamp_hash: await authorizedReadStampHash(payload),
  };
};

describe("AuthorityFreshnessIndex", () => {
  test("rejects a read that began before an exact revoke and never publishes it", async () => {
    const index = new AuthorityFreshnessIndex();
    const lease = index.beginRead({
      deliveryAddress: address,
      storeEpoch: "epoch-1",
      observedCommitSeq: 1,
      subject: page("page-a"),
      requestDependencies: [page("page-a")],
    });
    index.admitVisibility({
      deliveryAddress: address,
      storeEpoch: "epoch-1",
      commitSeq: 2,
      change: "revoke",
      roots: [page("page-a")],
    });

    await expect(index.admitRead(
      lease,
      await stamp({ subject: page("page-a"), commitSeq: 1 }),
      vi.fn(),
    )).rejects.toBeInstanceOf(StaleAuthorizedReadError);

    expect(index.diagnostics()).toMatchObject({ inFlightReads: 0 });
  });

  test("fences only registrations whose Core-authored roots were revoked", async () => {
    const index = new AuthorityFreshnessIndex();
    const fenceA = vi.fn();
    const fenceB = vi.fn();
    const leaseA = index.beginRead({
      deliveryAddress: address,
      storeEpoch: "epoch-1",
      observedCommitSeq: 2,
      subject: page("page-a"),
      requestDependencies: [page("page-a")],
    });
    const leaseB = index.beginRead({
      deliveryAddress: address,
      storeEpoch: "epoch-1",
      observedCommitSeq: 2,
      subject: page("page-b"),
      requestDependencies: [page("page-b")],
    });
    await index.admitRead(
      leaseA,
      await stamp({ subject: page("page-a"), commitSeq: 2 }),
      fenceA,
    );
    await index.admitRead(
      leaseB,
      await stamp({ subject: page("page-b"), commitSeq: 2 }),
      fenceB,
    );

    index.admitVisibility({
      deliveryAddress: address,
      storeEpoch: "epoch-1",
      commitSeq: 3,
      change: "revoke",
      roots: [page("page-a")],
    });

    expect(fenceA).toHaveBeenCalledOnce();
    expect(fenceB).not.toHaveBeenCalled();
  });

  test("preserves direct, ancestor, membership, and overlapping grant symmetry", async () => {
    const index = new AuthorityFreshnessIndex();
    const fenceA = vi.fn();
    const fenceB = vi.fn();
    const ancestor = page("page-ancestor");
    const membership = database("database-membership");
    const leaseA = index.beginRead({
      deliveryAddress: address,
      observedCommitSeq: 1,
      subject: page("page-a"),
      requestDependencies: [page("page-a")],
    });
    const leaseB = index.beginRead({
      deliveryAddress: address,
      observedCommitSeq: 1,
      subject: page("page-b"),
      requestDependencies: [page("page-b")],
    });
    await index.admitRead(
      leaseA,
      await stamp({
        subject: page("page-a"),
        dependencies: [page("page-a"), ancestor, membership],
        commitSeq: 1,
      }),
      fenceA,
    );
    await index.admitRead(
      leaseB,
      await stamp({
        subject: page("page-b"),
        dependencies: [page("page-b"), ancestor],
        commitSeq: 1,
      }),
      fenceB,
    );

    index.admitVisibility({
      deliveryAddress: address,
      storeEpoch: "epoch-1",
      commitSeq: 2,
      change: "revoke",
      roots: [membership],
    });
    expect(fenceA).toHaveBeenCalledOnce();
    expect(fenceB).not.toHaveBeenCalled();

    index.admitVisibility({
      deliveryAddress: address,
      storeEpoch: "epoch-1",
      commitSeq: 3,
      change: "revoke",
      roots: [ancestor],
    });
    expect(fenceA).toHaveBeenCalledTimes(2);
    expect(fenceB).toHaveBeenCalledOnce();
  });

  test("address reset fences every entry and rejects the older response", async () => {
    const index = new AuthorityFreshnessIndex();
    const fence = vi.fn();
    const adopted = index.beginRead({
      deliveryAddress: address,
      storeEpoch: "epoch-1",
      observedCommitSeq: 1,
      subject: page("page-a"),
      requestDependencies: [page("page-a")],
    });
    await index.admitRead(
      adopted,
      await stamp({ subject: page("page-a"), commitSeq: 1 }),
      fence,
    );
    const stale = index.beginRead({
      deliveryAddress: address,
      storeEpoch: "epoch-1",
      observedCommitSeq: 1,
      subject: page("page-b"),
      requestDependencies: [page("page-b")],
    });

    index.admitAddressReset({
      deliveryAddress: address,
      storeEpoch: "epoch-1",
      requiredCommitSeq: 4,
    });

    expect(fence).toHaveBeenCalledOnce();
    await expect(index.admitRead(
      stale,
      await stamp({ subject: page("page-b"), commitSeq: 3 }),
      vi.fn(),
    )).rejects.toBeInstanceOf(StaleAuthorizedReadError);
  });

  test("root floor GC waits for an older in-flight lease", () => {
    const index = new AuthorityFreshnessIndex();
    const lease = index.beginRead({
      deliveryAddress: address,
      storeEpoch: "epoch-1",
      observedCommitSeq: 1,
      subject: page("page-a"),
      requestDependencies: [page("page-a")],
    });
    index.admitVisibility({
      deliveryAddress: address,
      storeEpoch: "epoch-1",
      commitSeq: 2,
      change: "grant",
      roots: [page("page-a")],
    });
    expect(index.diagnostics().rootFloors).toBe(1);

    index.releaseRead(lease);

    expect(index.diagnostics().rootFloors).toBe(0);
    const next = index.beginRead({
      deliveryAddress: address,
      storeEpoch: "epoch-1",
      observedCommitSeq: 0,
      subject: page("page-a"),
      requestDependencies: [page("page-a")],
    });
    expect(next.observedCommitSeq).toBe(2);
  });

  test("root overflow fails closed instead of dropping the oldest floor", () => {
    const index = new AuthorityFreshnessIndex({ maxRootFloors: 1 });
    const fence = vi.fn();
    const lease = index.beginRead({
      deliveryAddress: address,
      storeEpoch: "epoch-1",
      observedCommitSeq: 1,
      subject: page("page-a"),
      requestDependencies: [page("page-a")],
    });
    void index.admitRead(
      lease,
      // Deliberately unresolved; the overflow assertion is synchronous.
      {} as AuthorizedReadStamp,
      fence,
    ).catch(() => undefined);
    index.admitVisibility({
      deliveryAddress: address,
      storeEpoch: "epoch-1",
      commitSeq: 2,
      change: "revoke",
      roots: [page("page-a")],
    });

    expect(() => index.admitVisibility({
      deliveryAddress: address,
      storeEpoch: "epoch-1",
      commitSeq: 3,
      change: "revoke",
      roots: [page("page-b")],
    })).toThrow(AuthorityFreshnessCapacityError);
    expect(index.diagnostics()).toMatchObject({ rootFloors: 0, addressFloors: 1 });
  });

  test("in-flight overflow fences the address and rejects an older response", async () => {
    const index = new AuthorityFreshnessIndex({ maxInFlightReads: 1 });
    const fence = vi.fn();
    const adopted = index.beginRead({
      deliveryAddress: address,
      storeEpoch: "epoch-1",
      observedCommitSeq: 4,
      subject: page("page-adopted"),
      requestDependencies: [page("page-adopted")],
    });
    const registration = await index.admitRead(
      adopted,
      await stamp({ subject: page("page-adopted"), commitSeq: 4 }),
      fence,
    );
    const stale = index.beginRead({
      deliveryAddress: address,
      storeEpoch: "epoch-1",
      observedCommitSeq: 4,
      subject: page("page-stale"),
      requestDependencies: [page("page-stale")],
    });

    expect(() => index.beginRead({
      deliveryAddress: address,
      storeEpoch: "epoch-1",
      observedCommitSeq: 4,
      subject: page("page-overflow"),
      requestDependencies: [page("page-overflow")],
    })).toThrow(AuthorityFreshnessCapacityError);
    expect(fence).toHaveBeenCalledWith(expect.objectContaining({
      kind: "address_reset",
      commitSeq: 4,
    }));
    expect(index.diagnostics()).toMatchObject({
      addressFloors: 1,
      inFlightReads: 1,
    });

    await expect(index.admitRead(
      stale,
      await stamp({ subject: page("page-stale"), commitSeq: 4 }),
      vi.fn(),
    )).rejects.toBeInstanceOf(StaleAuthorizedReadError);
    expect(index.diagnostics().inFlightReads).toBe(0);
    registration.release();
  });

  test("registration overflow fences the address without evicting an older claim", async () => {
    const index = new AuthorityFreshnessIndex({ maxRegistrations: 1 });
    const fence = vi.fn();
    const first = index.beginRead({
      deliveryAddress: address,
      storeEpoch: "epoch-1",
      observedCommitSeq: 5,
      subject: page("page-first"),
      requestDependencies: [page("page-first")],
    });
    const registration = await index.admitRead(
      first,
      await stamp({ subject: page("page-first"), commitSeq: 5 }),
      fence,
    );
    const overflow = index.beginRead({
      deliveryAddress: address,
      storeEpoch: "epoch-1",
      observedCommitSeq: 5,
      subject: page("page-overflow"),
      requestDependencies: [page("page-overflow")],
    });

    await expect(index.admitRead(
      overflow,
      await stamp({ subject: page("page-overflow"), commitSeq: 5 }),
      vi.fn(),
    )).rejects.toBeInstanceOf(AuthorityFreshnessCapacityError);
    expect(fence).toHaveBeenCalledWith(expect.objectContaining({
      kind: "address_reset",
      commitSeq: 5,
    }));
    expect(index.diagnostics()).toMatchObject({
      addressFloors: 1,
      registrations: 1,
    });
    registration.release();
  });

  test("address overflow rejects the new address without dropping the active one", () => {
    const index = new AuthorityFreshnessIndex({ maxAddresses: 1 });
    index.observeAddress({
      deliveryAddress: address,
      storeEpoch: "epoch-1",
      commitSeq: 6,
    });

    expect(() => index.beginRead({
      deliveryAddress: {
        ...address,
        project_id: "project-overflow",
      },
      storeEpoch: "epoch-1",
      observedCommitSeq: 6,
      subject: page("page-overflow"),
      requestDependencies: [page("page-overflow")],
    })).toThrow(AuthorityFreshnessCapacityError);
    expect(index.diagnostics()).toMatchObject({
      addresses: 1,
      addressFloors: 0,
    });
  });

  test("keeps 10k protected root floors and fails closed at the hard bound", () => {
    const index = new AuthorityFreshnessIndex();
    const lease = index.beginRead({
      deliveryAddress: address,
      storeEpoch: "epoch-1",
      observedCommitSeq: 1,
      subject: page("page-read"),
      requestDependencies: [page("page-read")],
    });
    for (let value = 0; value < 10_000; value += 1) {
      index.admitVisibility({
        deliveryAddress: address,
        storeEpoch: "epoch-1",
        commitSeq: 2,
        change: "grant",
        roots: [page(`page-${value}`)],
      });
    }
    expect(index.diagnostics().rootFloors).toBe(10_000);

    expect(() => index.admitVisibility({
      deliveryAddress: address,
      storeEpoch: "epoch-1",
      commitSeq: 3,
      change: "grant",
      roots: [page("page-overflow")],
    })).toThrow(AuthorityFreshnessCapacityError);
    expect(index.diagnostics()).toMatchObject({ rootFloors: 0, addressFloors: 1 });
    index.releaseRead(lease);
  });
});
