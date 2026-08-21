import { createHash } from "node:crypto";

import { SEMANTIC_THEME_GENERATOR_VERSION, SEMANTIC_THEME_PROFILE } from "./profile";
import type { SemanticThemeArtifact, SemanticThemeProvenance } from "./types";

export const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Readonly<Record<string, unknown>>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalize(child)]),
  );
};

export const canonicalJson = (value: unknown): string => JSON.stringify(canonicalize(value));

export const semanticThemeProfileSha256 = (): string =>
  sha256(canonicalJson(SEMANTIC_THEME_PROFILE));

export const createSemanticThemeProvenance = (
  refVersion: string,
  artifacts: readonly SemanticThemeArtifact[],
): SemanticThemeProvenance => ({
  schemaVersion: 1,
  refVersion,
  profileSha256: semanticThemeProfileSha256(),
  generatorVersion: SEMANTIC_THEME_GENERATOR_VERSION,
  artifacts: artifacts
    .map((artifact) => ({ path: artifact.path, sha256: sha256(artifact.content) }))
    .sort((left, right) => left.path.localeCompare(right.path)),
});

export const renderSemanticThemeProvenance = (provenance: SemanticThemeProvenance): string =>
  `${JSON.stringify(provenance, null, 2)}\n`;

const PROVENANCE_KEYS = [
  "artifacts",
  "generatorVersion",
  "profileSha256",
  "refVersion",
  "schemaVersion",
] as const;

export const parseSemanticThemeProvenance = (value: string): SemanticThemeProvenance => {
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("THEME_PROVENANCE_INVALID");
  }
  const record = parsed as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (JSON.stringify(keys) !== JSON.stringify(PROVENANCE_KEYS)) {
    throw new Error("THEME_PROVENANCE_INVALID");
  }
  if (
    record.schemaVersion !== 1 ||
    typeof record.refVersion !== "string" ||
    typeof record.profileSha256 !== "string" ||
    record.generatorVersion !== SEMANTIC_THEME_GENERATOR_VERSION ||
    !Array.isArray(record.artifacts)
  ) {
    throw new Error("THEME_PROVENANCE_INVALID");
  }
  const artifacts = record.artifacts.map((artifact) => {
    if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) {
      throw new Error("THEME_PROVENANCE_INVALID");
    }
    const identity = artifact as Record<string, unknown>;
    if (
      JSON.stringify(Object.keys(identity).sort()) !== JSON.stringify(["path", "sha256"]) ||
      typeof identity.path !== "string" ||
      typeof identity.sha256 !== "string"
    ) {
      throw new Error("THEME_PROVENANCE_INVALID");
    }
    return { path: identity.path, sha256: identity.sha256 };
  });
  return {
    schemaVersion: 1,
    refVersion: record.refVersion,
    profileSha256: record.profileSha256,
    generatorVersion: SEMANTIC_THEME_GENERATOR_VERSION,
    artifacts,
  };
};
