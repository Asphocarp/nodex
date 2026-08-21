const LOCALHOST_PATTERN = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?(?:[/?#].*)?$/i;
const HAS_SCHEME_PATTERN = /^[a-z][a-z\d+\-.]*:/i;
const MAX_BROWSER_URL_LENGTH = 16_384;
const ALLOWED_CHROME_PAGES = new Set(["downloads", "extensions", "history", "policy", "settings"]);

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

export function isAllowedBrowserNavigationUrl(url: string | null | undefined): boolean {
  const value = url?.trim() ?? "";
  if (value.length === 0 || value.length > MAX_BROWSER_URL_LENGTH) return false;
  if (value === "about:blank") return true;

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (parsed.username || parsed.password) return false;
  if (parsed.protocol === "http:" || parsed.protocol === "https:") return true;
  return parsed.protocol === "chrome:" && ALLOWED_CHROME_PAGES.has(parsed.hostname);
}

export function isAllowedBrowserExternalUrl(url: string | null | undefined): boolean {
  const value = url?.trim() ?? "";
  if (value.length === 0 || value.length > MAX_BROWSER_URL_LENGTH) return false;
  try {
    const parsed = new URL(value);
    if (parsed.username || parsed.password) return false;
    return ["http:", "https:", "mailto:", "tel:"].includes(parsed.protocol);
  } catch {
    return false;
  }
}
