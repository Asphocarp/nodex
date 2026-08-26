import { describe, expect, it } from "vitest";
import { createDueWorkOperationId, createStableOperationId } from "./operation-identity";

const RECEIPT_WINDOW_MS = 7 * 24 * 60 * 60 * 1_000;

describe("bounded due-work identities", () => {
  it("reuses one identity for retries of the same work episode and rotates after expiry", () => {
    const issuedAt = 1_800_000_000_000;
    const first = createDueWorkOperationId(
      "automation.claim-due",
      "work:stable",
      { limit: 10 },
      issuedAt,
    );
    const retry = createDueWorkOperationId(
      "automation.claim-due",
      "work:stable",
      { limit: 10 },
      issuedAt + 10_000,
    );
    const differentEpisode = createDueWorkOperationId(
      "automation.claim-due",
      "work:next",
      { limit: 10 },
      issuedAt + 10_000,
    );
    const afterExpiry = createDueWorkOperationId(
      "automation.claim-due",
      "work:stable",
      { limit: 10 },
      issuedAt + RECEIPT_WINDOW_MS,
    );

    expect(retry).toBe(first);
    expect(differentEpisode).not.toBe(first);
    expect(afterExpiry).not.toBe(first);
  });
});

describe("bounded child-operation identities", () => {
  it("derives a restart-stable identity from a durable parent coordinate", () => {
    const issuedAt = 1_800_000_000_000;
    const identity = ["thread:one", "turn:one", "call:one", "create_pages"];

    const first = createStableOperationId("nodex-agent.create-pages", issuedAt, identity);
    const replay = createStableOperationId("nodex-agent.create-pages", issuedAt, [...identity]);
    const otherCall = createStableOperationId("nodex-agent.create-pages", issuedAt, [
      "thread:one",
      "turn:one",
      "call:two",
      "create_pages",
    ]);

    expect(replay).toBe(first);
    expect(otherCall).not.toBe(first);
    expect(first).toMatch(
      /^nodexop:v1:1800000000000:1800604800000:nodex-agent\.create-pages:[a-f0-9]{64}$/u,
    );
  });
});
