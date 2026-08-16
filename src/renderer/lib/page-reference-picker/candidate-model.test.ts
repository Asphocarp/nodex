import { describe, expect, test } from "vitest";
import {
  deduplicatePageReferenceCandidates,
  presentPageReferenceCandidates,
  resolvePageReferenceDisabledReason,
  selectPageReferenceCandidate,
} from "./candidate-model";
import type { PageReferenceCandidate } from "./types";

const candidate = (pageId: string): PageReferenceCandidate => ({
  pageId,
  title: pageId,
  pageKey: null,
  status: null,
  locationLabel: "Library",
  lifecycle: "active",
  matchExcerpt: null,
  matchSource: "recent",
  disabledReason: null,
});

describe("Page reference candidate model", () => {
  test("blocks recursive embeds without blocking mentions or links", () => {
    const context = {
      pageId: "host",
      hostPageId: "host",
      ancestorPageIds: ["ancestor"],
    } as const;
    expect(
      resolvePageReferenceDisabledReason({
        ...context,
        intent: "reference_block",
      }),
    ).toBe("self");
    expect(
      resolvePageReferenceDisabledReason({
        ...context,
        pageId: "ancestor",
        intent: "reference_block",
      }),
    ).toBe("ancestor_cycle");
    expect(
      resolvePageReferenceDisabledReason({ ...context, intent: "mention" }),
    ).toBeNull();
    expect(
      resolvePageReferenceDisabledReason({ ...context, intent: "link" }),
    ).toBeNull();
  });

  test("uses Page identity for deduplication and enforces the hard bound", () => {
    expect(
      deduplicatePageReferenceCandidates(
        [candidate("one"), candidate("one"), candidate("two")],
        2,
      ).map((item) => item.pageId),
    ).toEqual(["one", "two"]);
    expect(deduplicatePageReferenceCandidates([candidate("one")], 100).length)
      .toBe(1);
  });

  test("fails selection closed for archived or disabled rows", () => {
    expect(selectPageReferenceCandidate(candidate("active"))).toEqual({
      pageId: "active",
      titleSnapshot: "active",
    });
    expect(
      selectPageReferenceCandidate({
        ...candidate("archived"),
        lifecycle: "archived",
      }),
    ).toBeNull();
    expect(
      selectPageReferenceCandidate({
        ...candidate("self"),
        disabledReason: "self",
      }),
    ).toBeNull();
  });

  test("shows Page context only for a key match, content hit, or ambiguity", () => {
    const items = [
      {
        ...candidate("unique"),
        title: "Unique",
        pageKey: "NDX-1",
        matchSource: "content" as const,
      },
      {
        ...candidate("duplicate-a"),
        title: "Weekly",
        locationLabel: "Product",
        matchSource: "title" as const,
      },
      {
        ...candidate("duplicate-b"),
        title: "Weekly",
        locationLabel: "Research",
        matchSource: "title" as const,
      },
      {
        ...candidate("content"),
        title: "Architecture",
        matchExcerpt: "A long preview explains the affected projection window and why this Page matched the query.",
        matchSource: "content" as const,
      },
    ];

    const presented = presentPageReferenceCandidates(items, "week");
    expect(presented[0]).toMatchObject({ detail: null, match: "content" });
    expect(presented[1]).toMatchObject({
      detail: "Product",
      match: "prefix_title",
    });
    expect(
      presented[1]?.titleSegments
        ?.filter(({ highlight }) => highlight)
        .map(({ text }) => text)
        .join(""),
    ).toBe("Weekly");
    expect(presented[2]).toMatchObject({
      detail: "Research",
      match: "prefix_title",
    });
    const pageKeyHit = presentPageReferenceCandidates([{
      ...items[0]!,
      matchSource: "page_key" as const,
    }], "NDX-1")[0];
    expect(pageKeyHit).toMatchObject({
      detail: "NDX-1",
      match: "page_key",
    });
    expect(
      pageKeyHit?.detailSegments
        ?.filter(({ highlight }) => highlight)
        .map(({ text }) => text)
        .join(""),
    ).toBe("NDX-1");
    const contentHit = presentPageReferenceCandidates(items, "projection")[3];
    expect(contentHit?.match).toBe("content");
    expect(contentHit?.detail?.includes("projection window")).toBe(true);
    expect(contentHit?.detail?.length).toBeLessThanOrEqual(90);

    const tailHit = presentPageReferenceCandidates([{
      ...candidate("tail-content"),
      title: "Keep projection updates bounded",
      matchExcerpt: "A deliberately longer preview explains that local commits should update only the affected projection window while preserving causal coverage.",
      matchSource: "content" as const,
    }], "caus")[0];
    expect(tailHit?.detail?.startsWith("…")).toBe(true);
    expect(tailHit?.detail?.endsWith("causal coverage.")).toBe(true);
    expect(tailHit?.detail?.indexOf("caus")).toBeLessThanOrEqual(24);
    expect(
      tailHit?.detailSegments
        ?.filter(({ highlight }) => highlight)
        .map(({ text }) => text)
        .join(""),
    ).toBe("causal");

    const shortTailHit = presentPageReferenceCandidates([{
      ...candidate("short-tail-content"),
      title: "Verify real Electron geometry",
      matchExcerpt: "Exercise the actual desktop boundary at the canonical viewport.",
      matchSource: "content" as const,
    }], "ca")[0];
    expect(shortTailHit?.detail?.startsWith("…")).toBe(true);
    expect(shortTailHit?.detail?.indexOf("canonical")).toBeLessThanOrEqual(24);
    expect(
      shortTailHit?.detailSegments
        ?.filter(({ highlight }) => highlight)
        .map(({ text }) => text)
        .join(""),
    ).toBe("canonical");
  });

  test("uses shared fuzzy evidence to rank and highlight title matches", () => {
    const items = presentPageReferenceCandidates([
      { ...candidate("other"), title: "Verify Electron geometry" },
      {
        ...candidate("target"),
        title: "Preserve local-first identity",
        matchExcerpt: "Preserve local-first identity",
        matchSource: "title" as const,
      },
    ], "presrve", { rank: true });

    expect(items[0]?.candidate.pageId).toBe("target");
    expect(items[0]?.match).toBe("title");
    expect(
      items[0]?.titleSegments
        ?.filter(({ highlight }) => highlight)
        .map(({ text }) => text)
        .join(""),
    ).toBe("Preserve");
  });

  test("does not turn a Core title match into a renderer content match", () => {
    const [presented] = presentPageReferenceCandidates([{
      ...candidate("mixed-match"),
      title: "Keep projection updates bounded",
      matchExcerpt: "The body also mentions projection, but the title matched first.",
      matchSource: "title",
    }], "projection");

    expect(presented?.match).toBe("title");
    expect(presented?.detail).toBeNull();
  });
});
