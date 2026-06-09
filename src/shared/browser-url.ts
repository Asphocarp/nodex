const LOCALHOST_PATTERN = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?(?:[/?#].*)?$/i;
const HAS_SCHEME_PATTERN = /^[a-z][a-z\d+\-.]*:/i;

export function normalizeBrowserNavigationUrl(rawValue: string | null | undefined): string {
  const value = rawValue?.trim() ?? "";
  if (value.length === 0) return "about:blank";
  if (LOCALHOST_PATTERN.test(value)) return `http://${value}`;
  if (HAS_SCHEME_PATTERN.test(value)) return value;
  if (value.includes(".") && !/\s/.test(value)) return `https://${value}`;
  return `https://www.google.com/search?q=${encodeURIComponent(value)}`;
}

export function isBlankBrowserUrl(url: string | null | undefined): boolean {
  const value = url?.trim();
  return !value || value === "about:blank";
}
