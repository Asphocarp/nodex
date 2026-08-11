import { ipcRenderer } from "electron";

const HOST_MESSAGE_CHANNEL = "nodex:mcp-app-sandbox-host-message";

ipcRenderer.on(HOST_MESSAGE_CHANNEL, (event, message) => {
  window.postMessage(message, "*", event.ports);
});
