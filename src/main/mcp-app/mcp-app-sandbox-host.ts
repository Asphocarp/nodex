import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  net,
  session as electronSession,
  type IpcMainEvent,
  type Net,
  type Session,
  type WebContents,
  type WebPreferences,
} from "electron";
import type { BackendLogger } from "../logging/logger";
import {
  MCP_APP_SANDBOX_GUEST_MESSAGE_CHANNEL,
  MCP_APP_SANDBOX_HOST_MESSAGE_CHANNEL,
  MCP_APP_SANDBOX_REMOTE_HOST,
  MCP_APP_SANDBOX_SCHEME,
  parseMcpAppSandboxGuestInitMessage,
  parseMcpAppSandboxSourceUrl,
  type McpAppSandboxHostInitMessage,
} from "../../shared/mcp-app/mcp-app-sandbox-contract";
import {
  createMcpAppSandboxProtocolHandler,
  getMcpAppSandboxCacheState,
  prewarmMcpAppSandbox,
} from "./mcp-app-sandbox-protocol";
import {
  decideMcpAppWebviewAttachment,
  isMcpAppSandboxPartition,
  type McpAppPendingAttachment,
} from "./mcp-app-webview-attachment-policy";

const PENDING_ATTACHMENT_TTL_MS = 30_000;
const mcpAppSandboxHostsByGuestId = new Map<number, McpAppSandboxHost>();
const pendingMcpAppAttachmentsBySession = new Map<Session, PendingMcpAppAttachment[]>();
let guestMessageListenerInstalled = false;
let defaultSessionHeadersInstalled = false;
const configuredMcpAppSandboxSessions = new WeakSet<Session>();

interface OwnedMcpAppAttachment extends McpAppPendingAttachment {
  ownerWebContents: WebContents;
}

interface AttachedMcpAppGuest extends OwnedMcpAppAttachment {
  guest: WebContents;
}

interface PendingMcpAppAttachment {
  state: OwnedMcpAppAttachment;
  timeout: ReturnType<typeof setTimeout>;
}

export interface McpAppSandboxHostOptions {
  allowLocalDevelopment: boolean;
  fetch?: Net["fetch"];
  guestPreloadPath: string;
  logger: BackendLogger;
}

interface McpWebviewParams {
  nodeintegration?: string;
  partition?: string;
  preload?: string;
  src?: string;
  webpreferences?: string;
}

function installGuestMessageListener(): void {
  if (guestMessageListenerInstalled) return;
  guestMessageListenerInstalled = true;
  ipcMain.on(MCP_APP_SANDBOX_GUEST_MESSAGE_CHANNEL, (event, rawMessage) => {
    mcpAppSandboxHostsByGuestId.get(event.sender.id)?.handleGuestMessage(event, rawMessage);
  });
}

function isSandboxHostUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const hostname = new URL(value).hostname;
    return (
      hostname === MCP_APP_SANDBOX_REMOTE_HOST ||
      hostname.endsWith(`.${MCP_APP_SANDBOX_REMOTE_HOST}`)
    );
  } catch {
    return false;
  }
}

function installDefaultSessionHeaders(): void {
  if (defaultSessionHeadersInstalled) return;
  defaultSessionHeadersInstalled = true;
  const defaultSession = electronSession.defaultSession;
  defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    const frame = details.frame;
    const requestHeaders = details.requestHeaders;
    const originHeader = Object.entries(requestHeaders).find(
      ([name]) => name.toLowerCase() === "origin",
    )?.[1];
    const refererHeader = Object.entries(requestHeaders).find(
      ([name]) => name.toLowerCase() === "referer",
    )?.[1];
    const belongsToSandbox =
      isSandboxHostUrl(frame?.origin) ||
      isSandboxHostUrl(frame?.url) ||
      isSandboxHostUrl(details.url) ||
      isSandboxHostUrl(originHeader) ||
      isSandboxHostUrl(refererHeader);
    callback({
      requestHeaders: belongsToSandbox
        ? rewriteSandboxRequestHeaders(requestHeaders, defaultSession.getUserAgent())
        : requestHeaders,
    });
  });
}

function registerPendingAttachment(state: OwnedMcpAppAttachment): void {
  const timeout = setTimeout(() => {
    const entries = pendingMcpAppAttachmentsBySession.get(state.session);
    if (!entries) return;
    const remaining = entries.filter((entry) => entry !== pending);
    if (remaining.length === 0) {
      pendingMcpAppAttachmentsBySession.delete(state.session);
      return;
    }
    pendingMcpAppAttachmentsBySession.set(state.session, remaining);
  }, PENDING_ATTACHMENT_TTL_MS);
  const pending = { state, timeout };
  const entries = pendingMcpAppAttachmentsBySession.get(state.session) ?? [];
  entries.push(pending);
  pendingMcpAppAttachmentsBySession.set(state.session, entries);
}

function consumePendingAttachment(input: {
  initId: string | null;
  ownerWebContents: WebContents;
  session: Session;
}): OwnedMcpAppAttachment | null {
  const entries = pendingMcpAppAttachmentsBySession.get(input.session);
  if (!entries) return null;
  const index = entries.findIndex(
    ({ state }) =>
      state.ownerWebContents.id === input.ownerWebContents.id &&
      (input.initId === null || state.initId === input.initId),
  );
  if (index < 0) return null;
  const [pending] = entries.splice(index, 1);
  if (!pending) return null;
  clearTimeout(pending.timeout);
  if (entries.length === 0) {
    pendingMcpAppAttachmentsBySession.delete(input.session);
  }
  return pending.state;
}

function removePendingAttachmentsForOwner(ownerWebContents: WebContents): void {
  for (const [sandboxSession, entries] of pendingMcpAppAttachmentsBySession) {
    const remaining = entries.filter((entry) => {
      if (entry.state.ownerWebContents.id !== ownerWebContents.id) return true;
      clearTimeout(entry.timeout);
      return false;
    });
    if (remaining.length === 0) {
      pendingMcpAppAttachmentsBySession.delete(sandboxSession);
      continue;
    }
    if (remaining.length !== entries.length) {
      pendingMcpAppAttachmentsBySession.set(sandboxSession, remaining);
    }
  }
}

function isLoopbackHttpUrl(url: URL): boolean {
  if (url.protocol !== "http:" && url.protocol !== "ws:") return false;
  return url.hostname === "localhost";
}

export function isAllowedMcpAppSandboxRequestUrl(
  value: string,
  options: { allowLocalDevelopment: boolean },
): boolean {
  try {
    const url = new URL(value);
    if (url.protocol === `${MCP_APP_SANDBOX_SCHEME}:`) {
      return (
        url.hostname === MCP_APP_SANDBOX_REMOTE_HOST ||
        url.hostname.endsWith(`.${MCP_APP_SANDBOX_REMOTE_HOST}`)
      );
    }
    if (["about:", "blob:", "data:", "devtools:", "https:", "wss:"].includes(url.protocol)) {
      return true;
    }
    return options.allowLocalDevelopment && isLoopbackHttpUrl(url);
  } catch {
    return false;
  }
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function stripElectronProductTokens(userAgent: string): string {
  return ["Electron", app.getName()]
    .filter(Boolean)
    .reduce(
      (value, product) =>
        value.replace(new RegExp(`\\s${escapeRegularExpression(product)}/[^\\s]+`, "gu"), ""),
      userAgent,
    )
    .replace(/\s{2,}/gu, " ")
    .trim();
}

function preferredAcceptLanguage(): string {
  const languages = app.getPreferredSystemLanguages();
  return (languages.length > 0 ? languages : [app.getLocale()])
    .map((language, index) =>
      index === 0 ? language : `${language};q=${Math.max(1 - index * 0.1, 0.1).toFixed(1)}`,
    )
    .join(",");
}

function setRequestHeader(headers: Record<string, string>, name: string, value: string): void {
  const existingName = Object.keys(headers).find(
    (candidate) => candidate.toLowerCase() === name.toLowerCase(),
  );
  if (existingName && existingName !== name) delete headers[existingName];
  headers[name] = value;
}

function rewriteSandboxRequestHeaders(
  headers: Record<string, string>,
  userAgent: string,
): Record<string, string> {
  const rewritten = { ...headers };
  const sanitizedUserAgent = stripElectronProductTokens(userAgent);
  setRequestHeader(rewritten, "User-Agent", sanitizedUserAgent);
  setRequestHeader(rewritten, "Accept-Language", preferredAcceptLanguage());
  const chromiumMajor = /\b(?:Chrome|Chromium)\/(\d+)\./u.exec(sanitizedUserAgent)?.[1];
  if (chromiumMajor) {
    setRequestHeader(
      rewritten,
      "sec-ch-ua",
      `"Chromium";v="${chromiumMajor}", "Google Chrome";v="${chromiumMajor}", "Not=A?Brand";v="24"`,
    );
  }
  setRequestHeader(rewritten, "sec-ch-ua-mobile", "?0");
  const platform =
    process.platform === "darwin"
      ? '"macOS"'
      : process.platform === "win32"
        ? '"Windows"'
        : '"Linux"';
  setRequestHeader(rewritten, "sec-ch-ua-platform", platform);
  return rewritten;
}

function isSameSandboxDocument(expected: string, candidate: string): boolean {
  try {
    const expectedUrl = new URL(expected);
    const candidateUrl = new URL(candidate);
    return (
      candidateUrl.protocol === expectedUrl.protocol &&
      candidateUrl.host === expectedUrl.host &&
      candidateUrl.pathname === expectedUrl.pathname &&
      candidateUrl.search === expectedUrl.search
    );
  } catch {
    return false;
  }
}

function isBlockedSandboxSubframeUrl(value: string): boolean {
  try {
    return !["about:", "blob:", "data:", "http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return true;
  }
}

export class McpAppSandboxHost {
  readonly #attachedGuests = new Map<number, AttachedMcpAppGuest>();
  readonly #options: McpAppSandboxHostOptions;
  readonly #owner: WebContents;
  #disposed = false;

  constructor(owner: WebContents, options: McpAppSandboxHostOptions) {
    this.#owner = owner;
    this.#options = options;
  }

  installForOwner(): () => void {
    let installed = true;
    const uninstall = () => {
      if (!installed) return;
      installed = false;
      this.dispose();
    };
    installDefaultSessionHeaders();
    installGuestMessageListener();
    this.#owner.once("destroyed", uninstall);
    return uninstall;
  }

  handlesPartition(partition: string | null | undefined): boolean {
    return isMcpAppSandboxPartition(partition);
  }

  handleWillAttach(
    event: Electron.Event,
    webPreferences: WebPreferences,
    rawParams: McpWebviewParams,
  ): void {
    if (this.#disposed) {
      event.preventDefault();
      return;
    }

    const decision = decideMcpAppWebviewAttachment({
      partition: rawParams.partition,
      src: rawParams.src,
    });
    if (!decision.ok) {
      this.#options.logger.warn("Rejected MCP App webview attachment", {
        ownerWebContentsId: this.#owner.id,
        reason: decision.reason,
      });
      event.preventDefault();
      return;
    }

    const partition = rawParams.partition ?? "";
    const sandboxSession = this.#getOrConfigureSession(partition);
    const sourceUrl = decision.source.sourceUrl;
    const cacheState = getMcpAppSandboxCacheState(sourceUrl);
    registerPendingAttachment({
      initId: decision.initId,
      origin: decision.source.origin,
      ownerWebContents: this.#owner,
      partition,
      sandboxId: decision.sandboxId,
      session: sandboxSession,
      skybridgeCacheState: cacheState,
      source: decision.source,
      sourceUrl,
    });
    void prewarmMcpAppSandbox({
      fetch: this.#options.fetch ?? net.fetch,
      locale: decision.source.locale,
    }).catch((error: unknown) => {
      this.#options.logger.warn("MCP App sandbox prewarm failed", {
        error,
        partition,
      });
    });

    Object.assign(webPreferences, {
      allowRunningInsecureContent: false,
      contextIsolation: true,
      devTools: true,
      disableDialogs: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      plugins: false,
      preload: this.#options.guestPreloadPath,
      sandbox: true,
      session: sandboxSession,
      webSecurity: true,
      webviewTag: false,
    });
    rawParams.partition = partition;
    delete rawParams.nodeintegration;
    delete rawParams.preload;
    delete rawParams.webpreferences;
    delete (webPreferences as WebPreferences & { preloadURL?: string }).preloadURL;
  }

  handleDidAttach(guest: WebContents): boolean {
    const source = parseMcpAppSandboxSourceUrl(guest.getURL());
    const pending = consumePendingAttachment({
      initId: source?.initId ?? null,
      ownerWebContents: this.#owner,
      session: guest.session,
    });
    if (!pending) {
      if (!configuredMcpAppSandboxSessions.has(guest.session)) return false;
      this.#options.logger.warn("Rejected unmatched MCP App guest", {
        guestWebContentsId: guest.id,
        ownerWebContentsId: this.#owner.id,
      });
      guest.close();
      return true;
    }

    if (
      guest.session !== pending.session ||
      pending.ownerWebContents.id !== this.#owner.id ||
      this.#owner.isDestroyed()
    ) {
      this.#options.logger.warn("Rejected mismatched MCP App guest", {
        guestWebContentsId: guest.id,
        ownerWebContentsId: this.#owner.id,
      });
      guest.close();
      return true;
    }

    const attached: AttachedMcpAppGuest = {
      ...pending,
      guest,
    };
    this.#attachedGuests.set(guest.id, attached);
    mcpAppSandboxHostsByGuestId.set(guest.id, this);
    this.#installGuestPolicy(attached);
    return true;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    removePendingAttachmentsForOwner(this.#owner);
    for (const attached of this.#attachedGuests.values()) {
      mcpAppSandboxHostsByGuestId.delete(attached.guest.id);
      if (!attached.guest.isDestroyed()) attached.guest.close();
    }
    this.#attachedGuests.clear();
  }

  #getOrConfigureSession(partition: string): Session {
    const sandboxSession = electronSession.fromPartition(partition);
    if (configuredMcpAppSandboxSessions.has(sandboxSession)) return sandboxSession;
    configuredMcpAppSandboxSessions.add(sandboxSession);
    sandboxSession.setPermissionCheckHandler(() => false);
    sandboxSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
      callback(false);
    });
    sandboxSession.on("will-download", (event, item) => {
      event.preventDefault();
      item.cancel();
    });
    sandboxSession.webRequest.onBeforeRequest((details, callback) => {
      callback({
        cancel: !isAllowedMcpAppSandboxRequestUrl(details.url, {
          allowLocalDevelopment: this.#options.allowLocalDevelopment,
        }),
      });
    });
    sandboxSession.webRequest.onBeforeSendHeaders((details, callback) => {
      callback({
        requestHeaders: rewriteSandboxRequestHeaders(
          details.requestHeaders,
          sandboxSession.getUserAgent(),
        ),
      });
    });
    const protocolHandler = createMcpAppSandboxProtocolHandler({
      fetch: this.#options.fetch ?? net.fetch,
    });
    void sandboxSession.protocol.handle(MCP_APP_SANDBOX_SCHEME, protocolHandler);
    return sandboxSession;
  }

  #installGuestPolicy(attached: AttachedMcpAppGuest): void {
    const { guest, sourceUrl } = attached;
    guest.setWindowOpenHandler(() => ({ action: "deny" }));
    guest.on("will-navigate", (event, url) => {
      const navigation = event as Electron.Event & { url?: string };
      const candidate = navigation.url ?? url;
      if (!isSameSandboxDocument(sourceUrl, candidate)) event.preventDefault();
    });
    guest.on("will-frame-navigate", (event) => {
      const navigation = event as Electron.Event & {
        isMainFrame: boolean;
        url: string;
      };
      const shouldBlock = navigation.isMainFrame
        ? !isSameSandboxDocument(sourceUrl, navigation.url)
        : isBlockedSandboxSubframeUrl(navigation.url);
      if (shouldBlock) event.preventDefault();
    });
    guest.on("will-redirect", (event, url, _isInPlace, isMainFrame) => {
      const redirect = event as Electron.Event & {
        isMainFrame?: boolean;
        url?: string;
      };
      const candidate = redirect.url ?? url;
      const redirectIsMainFrame = redirect.isMainFrame ?? isMainFrame;
      const shouldBlock = redirectIsMainFrame
        ? !isSameSandboxDocument(sourceUrl, candidate)
        : isBlockedSandboxSubframeUrl(candidate);
      if (shouldBlock) event.preventDefault();
    });
    guest.on("did-fail-load", (_event, code, description, url, isMainFrame) => {
      if (code === -3) return;
      this.#options.logger.warn("MCP App guest failed to load", {
        code,
        description,
        guestWebContentsId: guest.id,
        isMainFrame,
        url,
      });
    });
    guest.on("preload-error", (_event, preloadPath, error) => {
      this.#options.logger.error("MCP App guest preload failed", {
        error,
        guestWebContentsId: guest.id,
        preloadPath,
      });
    });
    guest.on("render-process-gone", (_event, details) => {
      if (details.reason === "clean-exit") return;
      this.#options.logger.warn("MCP App guest renderer exited", {
        details,
        guestWebContentsId: guest.id,
      });
    });
    guest.on("context-menu", () => {
      Menu.buildFromTemplate([
        {
          label: "DevTools",
          click: () => {
            if (guest.isDestroyed()) return;
            guest.openDevTools({ mode: "detach" });
          },
        },
      ]).popup({
        window: BrowserWindow.fromWebContents(attached.ownerWebContents) ?? undefined,
      });
    });
    guest.once("destroyed", () => {
      this.#attachedGuests.delete(guest.id);
      mcpAppSandboxHostsByGuestId.delete(guest.id);
    });
  }

  handleGuestMessage(event: IpcMainEvent, rawMessage: unknown): void {
    const attached = this.#attachedGuests.get(event.sender.id);
    if (!attached || this.#owner.isDestroyed()) return;

    const message = parseMcpAppSandboxGuestInitMessage(rawMessage);
    if (
      !message ||
      message.initId !== attached.initId ||
      message.origin !== attached.origin ||
      message.portNames.length + 1 !== event.ports.length
    ) {
      this.#options.logger.warn("Rejected MCP App guest port handoff", {
        guestWebContentsId: event.sender.id,
        ownerWebContentsId: this.#owner.id,
      });
      return;
    }

    const hostMessage: McpAppSandboxHostInitMessage = {
      ...message,
      sandboxId: attached.sandboxId,
      ...(attached.skybridgeCacheState
        ? { skybridgeCacheState: attached.skybridgeCacheState }
        : {}),
    };
    this.#owner.postMessage(MCP_APP_SANDBOX_HOST_MESSAGE_CHANNEL, hostMessage, event.ports);
  }
}
