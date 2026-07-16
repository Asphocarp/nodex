export const NODEX_DEEPLINK_PROTOCOL = "nodex:";
export const NODEX_PAGE_DEEPLINK_KIND = "pages";
export const NODEX_SESSION_DEEPLINK_KIND = "sessions";

const NODEX_PAGE_DEEPLINK_PREFIX = `${NODEX_DEEPLINK_PROTOCOL}//${NODEX_PAGE_DEEPLINK_KIND}/`;
const NODEX_SESSION_DEEPLINK_PREFIX = `${NODEX_DEEPLINK_PROTOCOL}//${NODEX_SESSION_DEEPLINK_KIND}/`;

export interface PageDeepLinkTarget {
  pageId: string;
}

export interface SessionDeepLinkTarget {
  sessionId: string;
}

function normalizeDeepLinkId(value: string): string | null {
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function decodePathSegment(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

export function buildPageDeepLink(target: PageDeepLinkTarget): string {
  return `${NODEX_PAGE_DEEPLINK_PREFIX}${encodeURIComponent(target.pageId)}`;
}

export function buildSessionDeepLink(target: SessionDeepLinkTarget): string {
  return `${NODEX_SESSION_DEEPLINK_PREFIX}${encodeURIComponent(target.sessionId)}`;
}

export function parsePageDeepLink(value: string): PageDeepLinkTarget | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  if (url.protocol !== NODEX_DEEPLINK_PROTOCOL) {
    return null;
  }

  const host = url.hostname.trim().toLowerCase();
  const pathSegments = url.pathname
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  const pageId = host === NODEX_PAGE_DEEPLINK_KIND
    ? normalizeDeepLinkId(decodePathSegment(pathSegments[0] ?? "") ?? "")
    : host.length === 0 && pathSegments[0]?.toLowerCase() === NODEX_PAGE_DEEPLINK_KIND
      ? normalizeDeepLinkId(decodePathSegment(pathSegments[1] ?? "") ?? "")
      : null;

  if (!pageId) {
    return null;
  }

  return { pageId };
}

export function parseSessionDeepLink(value: string): SessionDeepLinkTarget | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  if (url.protocol !== NODEX_DEEPLINK_PROTOCOL) {
    return null;
  }

  const host = url.hostname.trim().toLowerCase();
  const pathSegments = url.pathname
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  const sessionId = host === NODEX_SESSION_DEEPLINK_KIND
    ? normalizeDeepLinkId(decodePathSegment(pathSegments[0] ?? "") ?? "")
    : host.length === 0 && pathSegments[0]?.toLowerCase() === NODEX_SESSION_DEEPLINK_KIND
      ? normalizeDeepLinkId(decodePathSegment(pathSegments[1] ?? "") ?? "")
      : null;

  if (!sessionId) {
    return null;
  }

  return { sessionId };
}
