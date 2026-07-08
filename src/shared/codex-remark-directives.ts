const REMARK_DIRECTIVE_LINE_PATTERN = /^::[a-zA-Z0-9-]+.*$/gm;

export function stripCodexRemarkDirectiveLines(value: string | null | undefined): string {
  return (value ?? "")
    .replace(REMARK_DIRECTIVE_LINE_PATTERN, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
