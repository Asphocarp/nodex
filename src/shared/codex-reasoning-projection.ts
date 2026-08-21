function asReasoningParts(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

export function projectCodexReasoningSummary(summary: unknown): string {
  const [first, ...rest] = asReasoningParts(summary);
  if (typeof first !== "string") return "";

  if (rest.length === 0) return first;
  if (first.startsWith("**")) {
    return [first, ...rest].join("\n\n");
  }
  return [`**${first}**`, ...rest].join("\n\n");
}

export function parseCodexReasoningBuffers(value: unknown): {
  summary: string[];
  content: string[];
} {
  const candidate =
    typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
  return {
    summary: asReasoningParts(candidate?.summary),
    content: asReasoningParts(candidate?.content),
  };
}
