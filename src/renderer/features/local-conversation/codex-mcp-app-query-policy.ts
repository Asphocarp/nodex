import type { CodexAccountSnapshot } from "../../lib/types";

export function shouldEnableCodexMcpAppsQuery(input: {
  account: CodexAccountSnapshot | null;
  appsFeatureEnabled: boolean;
  callerEnabled: boolean;
  productSupportsApps: boolean;
}): boolean {
  return input.productSupportsApps
    && input.callerEnabled
    && input.appsFeatureEnabled
    && input.account?.account?.type === "chatgpt";
}
