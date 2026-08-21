import { useCodexExperimentalFeatures, useMcpApps } from "../../lib/use-mcp-queries";
import { CODEX_INTEGRATION_CAPABILITIES } from "../../../shared/codex-integration-capabilities";
import { useLocalConversationAccount } from "./local-conversation-store";
import { shouldEnableCodexMcpAppsQuery } from "./codex-mcp-app-query-policy";

export function useCodexMcpApps(options: { enabled?: boolean } = {}) {
  const account = useLocalConversationAccount();
  const callerEnabled = options.enabled !== false;
  const hasChatGptIdentity = account?.account?.type === "chatgpt";
  const { data: experimentalFeatures = [] } = useCodexExperimentalFeatures({
    enabled: CODEX_INTEGRATION_CAPABILITIES.chatGptApps && callerEnabled && hasChatGptIdentity,
  });
  return useMcpApps({
    enabled: shouldEnableCodexMcpAppsQuery({
      account,
      appsFeatureEnabled: experimentalFeatures.some(
        (feature) => feature.name === "apps" && feature.enabled,
      ),
      callerEnabled,
      productSupportsApps: CODEX_INTEGRATION_CAPABILITIES.chatGptApps,
    }),
  });
}
