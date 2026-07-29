import type {
  BrowserSiteInfo,
} from "../../shared/browser-profile";
import type { BrowserSidebarTabIdentity } from "../../shared/browser-sidebar";

interface BrowserSiteInfoTabReader {
  getTabSnapshot(identity: BrowserSidebarTabIdentity): {
    url: string;
  } | null;
}

interface BrowserSiteInfoCookieStore {
  get(filter: { url: string }): Promise<unknown[]>;
}

const DEFAULT_BLOCKED_PERMISSIONS: BrowserSiteInfo["permissions"] = [
  { permission: "camera", state: "block" },
  { permission: "clipboard-read", state: "block" },
  { permission: "display-capture", state: "block" },
  { permission: "geolocation", state: "block" },
  { permission: "media", state: "block" },
  { permission: "microphone", state: "block" },
  { permission: "notifications", state: "block" },
  { permission: "open-external", state: "block" },
];

export class BrowserSiteInfoProvider {
  constructor(
    private readonly tabs: BrowserSiteInfoTabReader,
    private readonly cookies: BrowserSiteInfoCookieStore,
  ) {}

  async get(identity: BrowserSidebarTabIdentity): Promise<BrowserSiteInfo> {
    const tab = this.tabs.getTabSnapshot(identity);
    if (!tab) throw new Error("Browser tab is not registered");
    const site = parseSiteUrl(tab.url);
    const cookieCount = site
      ? (await this.cookies.get({ url: site.url.href })).length
      : 0;
    return {
      ...identity,
      url: tab.url,
      origin: site?.url.origin ?? null,
      connection: site?.connection ?? "none",
      cookieCount,
      permissions: DEFAULT_BLOCKED_PERMISSIONS.map((permission) => ({
        ...permission,
      })),
    };
  }
}

function parseSiteUrl(value: string): {
  url: URL;
  connection: BrowserSiteInfo["connection"];
} | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const local = url.hostname === "localhost"
    || url.hostname.endsWith(".localhost")
    || url.hostname === "127.0.0.1"
    || url.hostname === "[::1]"
    || url.hostname === "::1";
  return {
    url,
    connection: local
      ? "local"
      : url.protocol === "https:"
        ? "secure"
        : "insecure",
  };
}
