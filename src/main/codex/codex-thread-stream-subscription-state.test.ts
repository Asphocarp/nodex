import { describe, expect, test } from "vitest";
import {
  CODEX_THREAD_STREAM_FOLLOWER_RECONNECT_GRACE_MS,
  CodexThreadStreamSubscriptionState,
} from "./codex-thread-stream-subscription-state";

describe("CodexThreadStreamSubscriptionState", () => {
  test("tracks explicit followers and excludes the owner from targets", () => {
    const state = new CodexThreadStreamSubscriptionState();

    state.handleClientConnected("owner");
    state.handleClientConnected("follower");
    expect(state.setOwner("thread-1", "owner").actions).toEqual([
      {
        type: "request-following-status",
        conversationId: "thread-1",
        ownerClientId: "owner",
      },
    ]);
    state.setFollowing("thread-1", "owner", true);
    state.setFollowing("thread-1", "follower", true);
    state.markSnapshotDelivered("thread-1", "follower");

    expect(state.getFollowerClientIds("thread-1")).toEqual(["follower"]);
  });

  test("makes follow and unfollow idempotent and emits membership epochs", () => {
    const state = new CodexThreadStreamSubscriptionState();
    state.setOwner("thread-1", "owner");
    state.handleClientConnected("owner");
    state.handleClientConnected("follower");

    const first = state.setFollowing("thread-1", "follower", true);
    const second = state.setFollowing("thread-1", "follower", true);
    const snapshotActions = state.markSnapshotDelivered("thread-1", "follower");
    const third = state.setFollowing("thread-1", "follower", false);

    expect(first.changed).toBe(true);
    expect(first.shouldSendSnapshot).toBe(true);
    expect(first.actions[0]).toMatchObject({
      type: "followers-changed",
      followerClientIds: [],
      membershipEpoch: 1,
    });
    expect(snapshotActions[0]).toMatchObject({
      type: "followers-changed",
      followerClientIds: ["follower"],
      membershipEpoch: 1,
    });
    expect(second.changed).toBe(false);
    expect(third.actions[0]).toMatchObject({
      type: "followers-changed",
      followerClientIds: [],
      membershipEpoch: 2,
    });
  });

  test("keeps the recovery lease during the follower reconnect grace period", () => {
    let now = 100;
    const state = new CodexThreadStreamSubscriptionState({
      now: () => now,
    });
    state.setOwner("thread-1", "owner");
    state.handleClientConnected("owner");
    state.handleClientConnected("follower");
    state.setFollowing("thread-1", "follower", true);
    state.markSnapshotDelivered("thread-1", "follower");
    state.handleClientDisposed("follower");

    expect(state.hasFollowersOrPendingReconnect("thread-1")).toBe(true);
    now += CODEX_THREAD_STREAM_FOLLOWER_RECONNECT_GRACE_MS + 1;
    expect(state.hasFollowersOrPendingReconnect("thread-1")).toBe(false);
  });

  test("requests a status reannounce when an owner has no connected followers", () => {
    const state = new CodexThreadStreamSubscriptionState();
    state.setOwner("thread-1", "owner");
    state.handleClientConnected("owner");

    expect(state.handleClientConnected("new-client")).toEqual([
      {
        type: "request-following-status",
        conversationId: "thread-1",
        ownerClientId: "owner",
      },
    ]);
  });

  test("holds a newly attached follower behind a snapshot barrier", () => {
    const state = new CodexThreadStreamSubscriptionState();
    state.handleClientConnected("owner");
    state.handleClientConnected("follower");
    state.setOwner("thread-1", "owner");

    const following = state.setFollowing("thread-1", "follower", true);

    expect(following.shouldSendSnapshot).toBe(true);
    expect(state.getSnapshotClientIds("thread-1")).toEqual(["follower"]);
    expect(state.getFollowerClientIds("thread-1")).toEqual([]);

    state.markSnapshotDelivered("thread-1", "follower");

    expect(state.getSnapshotClientIds("thread-1")).toEqual([]);
    expect(state.getFollowerClientIds("thread-1")).toEqual(["follower"]);
  });

  test("requeues every follower snapshot when the owner is replaced", () => {
    const state = new CodexThreadStreamSubscriptionState();
    for (const clientId of ["owner-a", "owner-b", "follower"]) {
      state.handleClientConnected(clientId);
    }
    state.setOwner("thread-1", "owner-a");
    state.setFollowing("thread-1", "follower", true);
    state.markSnapshotDelivered("thread-1", "follower");

    const ownerChange = state.setOwner("thread-1", "owner-b");

    expect(ownerChange.snapshotClientIds).toEqual(["follower"]);
    expect(state.getFollowerClientIds("thread-1")).toEqual([]);
    expect(state.getSnapshotClientIds("thread-1")).toEqual(["follower"]);
  });

  test("turns a failed target delivery into a pending reconnect", () => {
    const state = new CodexThreadStreamSubscriptionState();
    state.handleClientConnected("owner");
    state.handleClientConnected("follower");
    state.setOwner("thread-1", "owner");
    state.setFollowing("thread-1", "follower", true);
    state.markSnapshotDelivered("thread-1", "follower");

    const resetActions = state.handleIpcConnectionReset("follower");

    expect(resetActions[0]).toMatchObject({
      type: "followers-changed",
      followerClientIds: [],
      targetClientIds: ["owner"],
    });
    expect(state.getFollowerClientIds("thread-1")).toEqual([]);
    expect(state.hasFollowersOrPendingReconnect("thread-1")).toBe(true);
  });

  test("does not clear a snapshot barrier after delivery fails synchronously", () => {
    const state = new CodexThreadStreamSubscriptionState();
    state.handleClientConnected("owner");
    state.handleClientConnected("follower");
    state.setOwner("thread-1", "owner");
    state.setFollowing("thread-1", "follower", true);

    state.handleIpcConnectionReset("follower");
    state.markSnapshotDelivered("thread-1", "follower");
    state.handleClientConnected("follower");

    expect(state.getSnapshotClientIds("thread-1")).toEqual(["follower"]);
    expect(state.getFollowerClientIds("thread-1")).toEqual([]);
  });
});
