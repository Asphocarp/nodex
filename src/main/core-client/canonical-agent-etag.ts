import { createHash } from "node:crypto";
import type { PortableRichText } from "../../shared/block-documents/portable-rich-text";

export interface CanonicalAgentBlockValue {
  readonly id: string;
  readonly type: string;
  readonly props: unknown;
  readonly content?: unknown;
  readonly children: readonly CanonicalAgentBlockValue[];
}

export type CanonicalAgentEtagKind =
  | "title"
  | "body"
  | "block_update"
  | "block_delete";

const canonicalJson = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(record).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalJson(record[key])}`
  ).join(",")}}`;
};

const mint = (
  kind: CanonicalAgentEtagKind,
  identity: string,
  value: unknown,
): string => `nxe1.${createHash("sha256")
  .update(canonicalJson(["nodex-canonical-agent-etag", 1, kind, identity, value]))
  .digest("base64url")}`;

export const canonicalAgentPageEtag = (
  kind: "title" | "body",
  pageId: string,
  value: PortableRichText | string,
): string => mint(kind, pageId, value);

export const canonicalAgentBlockEtag = (
  kind: "update" | "delete",
  block: CanonicalAgentBlockValue,
): string => mint(
  kind === "update" ? "block_update" : "block_delete",
  block.id,
  kind === "update"
    ? {
        type: block.type,
        props: block.props,
        ...(block.content === undefined ? {} : { content: block.content }),
      }
    : block,
);
