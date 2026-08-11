import { protocol } from "electron";
import { APP_RENDERER_PROTOCOL_SCHEME } from "../shared/app-renderer-policy";
import { MANAGED_ASSET_PROTOCOL_SCHEME } from "../shared/managed-assets";
import { MCP_APP_SANDBOX_SCHEME } from "../shared/mcp-app/mcp-app-sandbox-contract";

type PrivilegedSchemeRegistrar = (
  schemes: Electron.CustomScheme[],
) => void;

export function registerNodexPrivilegedSchemes(
  register: PrivilegedSchemeRegistrar = (schemes) => {
    protocol.registerSchemesAsPrivileged(schemes);
  },
): void {
  register([
    {
      scheme: APP_RENDERER_PROTOCOL_SCHEME,
      privileges: {
        secure: true,
        standard: true,
        stream: true,
        supportFetchAPI: true,
      },
    },
    {
      scheme: MANAGED_ASSET_PROTOCOL_SCHEME,
      privileges: {
        secure: true,
        standard: true,
      },
    },
    {
      scheme: MCP_APP_SANDBOX_SCHEME,
      privileges: {
        allowServiceWorkers: true,
        corsEnabled: true,
        secure: true,
        standard: true,
        stream: true,
        supportFetchAPI: true,
      },
    },
  ]);
}
