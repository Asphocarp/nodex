import { ipcRenderer } from "electron";
import {
  MCP_APP_OPTIONAL_GUEST_PORT_NAMES,
  MCP_APP_REQUIRED_GUEST_PORT_NAMES,
  MCP_APP_SANDBOX_GUEST_MESSAGE_CHANNEL,
  parseMcpAppSandboxSourceUrl,
  type McpAppGuestPortName,
} from "../shared/mcp-app/mcp-app-sandbox-contract";

const source = parseMcpAppSandboxSourceUrl(window.location.href);
let initializationConsumed = false;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function isMessagePort(value: unknown): value is MessagePort {
  return typeof value === "object"
    && value !== null
    && typeof (value as MessagePort).postMessage === "function"
    && typeof (value as MessagePort).start === "function";
}

window.addEventListener("message", (event) => {
  if (
    initializationConsumed
    || !source?.initId
    || source.origin !== window.location.origin
    || event.source !== window
  ) {
    return;
  }

  const data = asRecord(event.data);
  const ports = asRecord(data?.ports);
  const replyPort = data?.replyPort;
  if (data?.type !== "init" || !ports || !isMessagePort(replyPort)) return;

  const allPortNames = [
    ...MCP_APP_REQUIRED_GUEST_PORT_NAMES,
    ...MCP_APP_OPTIONAL_GUEST_PORT_NAMES,
  ];
  const portNames = allPortNames.filter(
    (name): name is McpAppGuestPortName => isMessagePort(ports[name]),
  );
  if (MCP_APP_REQUIRED_GUEST_PORT_NAMES.some((name) => !isMessagePort(ports[name]))) {
    return;
  }
  const transferredPorts = portNames.map((name) => ports[name] as MessagePort);

  initializationConsumed = true;
  ipcRenderer.postMessage(
    MCP_APP_SANDBOX_GUEST_MESSAGE_CHANNEL,
    {
      initId: source.initId,
      origin: window.location.origin,
      portNames,
      type: "init",
    },
    [...transferredPorts, replyPort],
  );
});
