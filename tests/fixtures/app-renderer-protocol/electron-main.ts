import path from "node:path";
import {
  app,
  BrowserWindow,
  protocol,
  session,
} from "electron";
import { registerAppRendererProtocol } from "../../../src/main/app-renderer-protocol";
import { registerNodexPrivilegedSchemes } from "../../../src/main/privileged-schemes";
import { APP_RENDERER_URL } from "../../../src/shared/app-renderer-policy";

const diagnosticsScheme: Electron.CustomScheme = {
  scheme: "nodex-test-diagnostics",
  privileges: {
    corsEnabled: true,
    secure: true,
    supportFetchAPI: true,
  },
};

// Diagnostics SDKs can register their own privileged protocol before wrapping
// later application registrations. The production origin must remain secure in
// the combined registration, not only when tested in isolation.
protocol.registerSchemesAsPrivileged([diagnosticsScheme]);
registerNodexPrivilegedSchemes((schemes) => {
  protocol.registerSchemesAsPrivileged([...schemes, diagnosticsScheme]);
});

void app.whenReady().then(async () => {
  const disposeProtocol = registerAppRendererProtocol(
    session.defaultSession,
    path.join(__dirname, "renderer"),
  );
  app.once("before-quit", disposeProtocol);
  const window = new BrowserWindow({
    show: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  await window.loadURL(APP_RENDERER_URL);
});
