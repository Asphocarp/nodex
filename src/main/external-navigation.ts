const EXTERNAL_URL_MAX_LENGTH = 8_192;

/** Accept only browser-safe, credential-free web URLs at the Electron shell boundary. */
export function parseExternalNavigationUrl(value: string): URL {
  if (value.length > EXTERNAL_URL_MAX_LENGTH) throw new Error("External URL is too long");
  const url = new URL(value);
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
    throw new Error("External navigation requires a credential-free HTTP(S) URL");
  }
  return url;
}
