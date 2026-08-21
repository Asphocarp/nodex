export interface LocalPathPresentationContext {
  homeDirectory: string;
  separator: "/" | "\\";
}

export function abbreviateHomeDirectory(
  value: string,
  context: LocalPathPresentationContext | null | undefined,
): string {
  if (!context) return value;

  const homeDirectory = context.homeDirectory.replace(new RegExp(`\\${context.separator}+$`), "");
  const comparableValue = context.separator === "\\" ? value.toLocaleLowerCase() : value;
  const comparableHome =
    context.separator === "\\" ? homeDirectory.toLocaleLowerCase() : homeDirectory;

  if (comparableValue === comparableHome) return "~";
  if (!comparableValue.startsWith(`${comparableHome}${context.separator}`)) {
    return value;
  }

  return `~${value.slice(homeDirectory.length)}`;
}
