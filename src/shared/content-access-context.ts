const MAX_CONTENT_ACCESS_ID_LENGTH = 512;

export type ContentAccessContext =
  | { readonly kind: "project"; readonly projectId: string }
  | { readonly kind: "library" };

const isRecord = (
  value: unknown,
): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const canonicalId = (value: unknown, label: string): string => {
  if (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_CONTENT_ACCESS_ID_LENGTH &&
    value === value.trim() &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  ) {
    return value;
  }
  throw new TypeError(`${label} must be a canonical non-empty identity`);
};

const assertExactKeys = (
  value: Readonly<Record<string, unknown>>,
  required: readonly string[],
): void => {
  const expected = new Set(required);
  for (const key of required) {
    if (Object.hasOwn(value, key)) continue;
    throw new TypeError(`contentAccessContext.${key} is required`);
  }
  for (const key of Object.keys(value)) {
    if (expected.has(key)) continue;
    throw new TypeError(`contentAccessContext.${key} is not supported`);
  }
};

export const parseContentAccessContext = (
  value: unknown,
): ContentAccessContext => {
  if (!isRecord(value)) {
    throw new TypeError("contentAccessContext must be an object");
  }
  if (value.kind === "library") {
    assertExactKeys(value, ["kind"]);
    return { kind: "library" };
  }
  if (value.kind === "project") {
    assertExactKeys(value, ["kind", "projectId"]);
    return {
      kind: "project",
      projectId: canonicalId(
        value.projectId,
        "contentAccessContext.projectId",
      ),
    };
  }
  throw new TypeError("contentAccessContext.kind is unsupported");
};

export const projectContentAccess = (
  projectId: string,
): ContentAccessContext =>
  parseContentAccessContext({ kind: "project", projectId });

export const libraryContentAccess: ContentAccessContext = {
  kind: "library",
};

/**
 * Resolve the real Project selected by a content authority boundary.
 *
 * Library content can use renderer-local document scope identifiers, but
 * those identifiers are never valid Project credentials. Project-only
 * capabilities must stay unavailable when this function returns null.
 */
export const projectIdFromContentAccessContext = (
  context: ContentAccessContext,
): string | null => context.kind === "project" ? context.projectId : null;

export const contentAccessContextKey = (
  context: ContentAccessContext,
): string => context.kind === "project"
  ? `project:${context.projectId}`
  : "library";
