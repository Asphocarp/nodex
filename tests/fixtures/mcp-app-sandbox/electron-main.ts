import path from "node:path";
import { app, BrowserWindow, protocol, session } from "electron";
import { McpAppSandboxHost } from "../../../src/main/mcp-app/mcp-app-sandbox-host";
import {
  MCP_APP_REQUIRED_GUEST_PORT_NAMES,
  MCP_APP_SANDBOX_SCHEME,
  appendMcpAppSandboxInitId,
  buildMcpAppSandboxPartition,
  buildMcpAppSandboxSourceUrl,
} from "../../../src/shared/mcp-app/mcp-app-sandbox-contract";

protocol.registerSchemesAsPrivileged([{
  scheme: MCP_APP_SANDBOX_SCHEME,
  privileges: {
    secure: true,
    standard: true,
    stream: true,
    supportFetchAPI: true,
    corsEnabled: true,
    allowServiceWorkers: true,
  },
}]);

const SKYBRIDGE_HTML = `<!doctype html>
<html>
  <body>
    <script>
      const names = ${JSON.stringify(MCP_APP_REQUIRED_GUEST_PORT_NAMES)};
      const retainedPorts = [];
      const ports = {};
      const transfer = names.map((name) => {
        const channel = new MessageChannel();
        retainedPorts.push(channel.port1);
        ports[name] = channel.port2;
        return channel.port2;
      });
      const reply = new MessageChannel();
      retainedPorts.push(reply.port1);
      transfer.push(reply.port2);
      window.__fixturePorts = retainedPorts;
      window.postMessage({
        type: "init",
        ports,
        replyPort: reply.port2,
      }, location.origin, transfer);
    </script>
  </body>
</html>`;

const FIXTURE_PARTITION = buildMcpAppSandboxPartition("source-0123456789abcdef");

const OWNER_HTML = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; frame-src nodex-mcp-sandbox:; child-src nodex-mcp-sandbox:">
    <title>MCP Sandbox Fixture</title>
  </head>
  <body>
    <main id="status">starting</main>
    <script>
      window.fixtureState = {
        didAttachAccepted: null,
        didAttachSessionMatched: null,
        didAttachUrl: null,
        error: null,
        guestId: null,
        handshake: false,
        portCount: 0,
        webviewCount: 0,
      };
      const sandbox = ${JSON.stringify({
        partition: FIXTURE_PARTITION,
        sourceUrl: appendMcpAppSandboxInitId(buildMcpAppSandboxSourceUrl({
          locale: "en-US",
          subdomain: "mcp-calendar-fixture",
        }), "fixture-init"),
      })};
      window.addEventListener("message", (event) => {
        if (event.data?.type !== "init") return;
        window.fixtureState.handshake = true;
        window.fixtureState.portCount = event.ports.length;
        document.querySelector("#status").textContent = "ready";
      });
      function attach(sandbox, repeated) {
        const webview = document.createElement("webview");
        webview.setAttribute("partition", sandbox.partition);
        webview.setAttribute("src", sandbox.sourceUrl);
        webview.addEventListener("dom-ready", () => {
          if (!repeated) window.fixtureState.guestId = webview.getWebContentsId();
        });
        webview.addEventListener("did-fail-load", () => {
          if (!repeated) window.fixtureState.error = "did-fail-load";
        });
        webview.addEventListener("console-message", (event) => {
          window.fixtureState.error = "guest-console:" + event.message;
        });
        webview.addEventListener("preload-error", () => {
          window.fixtureState.error = "preload-error";
        });
        document.body.append(webview);
        window.fixtureState.webviewCount = document.querySelectorAll("webview").length;
        setTimeout(() => {
          if (window.fixtureState.handshake) return;
          try {
            window.fixtureState.error = "webview-timeout:id=" + webview.getWebContentsId()
              + ";src=" + webview.getAttribute("src")
              + ";partition=" + webview.getAttribute("partition");
          } catch (error) {
            window.fixtureState.error = "webview-timeout:" + String(error?.stack || error);
          }
        }, 5_000);
      }
      window.attachAgain = () => attach(sandbox, true);
      try {
        attach(sandbox, false);
      } catch (error) {
        window.fixtureState.error = String(error?.stack || error);
      }
    </script>
  </body>
</html>`;

void app.whenReady().then(async () => {
  const ownerWindow = new BrowserWindow({
    width: 720,
    height: 520,
    show: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "owner-preload.js"),
      sandbox: true,
      webviewTag: true,
    },
  });
  const host = new McpAppSandboxHost(ownerWindow.webContents, {
    allowLocalDevelopment: false,
    fetch: async () => new Response(SKYBRIDGE_HTML, {
      headers: {
        "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'",
        "Content-Type": "text/html; charset=utf-8",
      },
    }),
    guestPreloadPath: path.join(__dirname, "mcp-app-sandbox-guest.js"),
    logger: {
      error: (message: string) => {
        void ownerWindow.webContents.executeJavaScript(
          `window.fixtureState.error = ${JSON.stringify(message)}`,
          false,
        );
      },
      warn: (message: string) => {
        void ownerWindow.webContents.executeJavaScript(
          `window.fixtureState.error = ${JSON.stringify(message)}`,
          false,
        );
      },
    } as never,
  });
  host.installForOwner();

  ownerWindow.webContents.on("will-attach-webview", (event, preferences, params) => {
    try {
      if (!host.handlesPartition(params.partition)) {
        event.preventDefault();
        return;
      }
      host.handleWillAttach(event, preferences, params);
    } catch (error) {
      event.preventDefault();
      void ownerWindow.webContents.executeJavaScript(
        `window.fixtureState.error = ${JSON.stringify("will-attach:")} + ${JSON.stringify(String(error))}`,
        false,
      );
    }
  });
  ownerWindow.webContents.on("did-attach-webview", (_event, guest) => {
    const didAttachUrl = guest.getURL();
    const didAttachSessionMatched = guest.session === session.fromPartition(FIXTURE_PARTITION);
    const didAttachAccepted = host.handleDidAttach(guest);
    void ownerWindow.webContents.executeJavaScript(
      `Object.assign(window.fixtureState, ${JSON.stringify({
        didAttachAccepted,
        didAttachSessionMatched,
        didAttachUrl,
      })})`,
      false,
    );
    if (!didAttachAccepted) {
      guest.close();
      return;
    }
    void ownerWindow.webContents.executeJavaScript(
      `window.fixtureState.guestId = ${guest.id}`,
      false,
    );
  });
  await ownerWindow.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(OWNER_HTML)}`,
  );
});
