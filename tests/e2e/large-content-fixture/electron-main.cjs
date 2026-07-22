const { app, BrowserWindow } = require("electron");

app.on("window-all-closed", () => {
  // The Playwright harness owns process lifetime and creates one window per
  // measured scenario so renderer state cannot leak between samples.
});

void app.whenReady().then(async () => {
  const host = new BrowserWindow({ show: false });
  await host.loadURL("about:blank");
});
