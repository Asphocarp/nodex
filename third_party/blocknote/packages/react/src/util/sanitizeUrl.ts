const SAFE_URL_PROTOCOLS = new Set([
  "file:",
  "http:",
  "https:",
  "mailto:",
  "tel:",
]);

function isAppFilesystemUrl(url: URL): boolean {
  return (
    url.protocol === "app:" &&
    url.hostname === "fs" &&
    !url.username &&
    !url.password &&
    url.pathname.startsWith("/@fs/")
  );
}

function sanitizeUrlWithProtocols(
  inputUrl: string,
  baseUrl: string,
  allowAppFilesystem: boolean,
): string {
  try {
    const url = new URL(inputUrl, baseUrl);

    if (
      SAFE_URL_PROTOCOLS.has(url.protocol) ||
      (allowAppFilesystem && isAppFilesystemUrl(url))
    ) {
      return url.href;
    }
  } catch {
    // if URL creation fails, it's an invalid URL
  }

  // return a safe default for invalid or unsafe URLs
  return "#";
}

/**
 * Sanitizes a potentially unsafe URL.
 * @param {string} inputUrl - The URL to sanitize.
 * @param {string} baseUrl - The base URL to use for relative URLs.
 * @returns {string} The normalized URL, or "#" if the URL is invalid or unsafe.
 */
export function sanitizeUrl(inputUrl: string, baseUrl: string): string {
  return sanitizeUrlWithProtocols(inputUrl, baseUrl, false);
}

/** Allows Nodex's read-only app filesystem protocol for file downloads. */
export function sanitizeFileUrl(inputUrl: string, baseUrl: string): string {
  return sanitizeUrlWithProtocols(inputUrl, baseUrl, true);
}
