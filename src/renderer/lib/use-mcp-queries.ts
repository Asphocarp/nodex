import { useQuery } from "@tanstack/react-query";
import {
  mcpResourceQueryOptions,
  mcpServerStatusesQueryOptions,
} from "./query-options";
import type { ProtocolMcpResourceReadParams } from "../../shared/types";

interface QueryEnabledOptions {
  enabled?: boolean;
}

const EMPTY_RESOURCE_PARAMS: ProtocolMcpResourceReadParams = {
  threadId: null,
  server: "",
  uri: "",
};

export function useMcpServerStatuses(
  threadId?: string | null,
  options: QueryEnabledOptions = {},
) {
  return useQuery({
    ...mcpServerStatusesQueryOptions(threadId),
    enabled: options.enabled !== false,
  });
}

export function useMcpResource(
  params: ProtocolMcpResourceReadParams | null,
  options: QueryEnabledOptions = {},
) {
  const effectiveParams = params ?? EMPTY_RESOURCE_PARAMS;
  const enabled = Boolean(
    options.enabled !== false
    && params
    && params.server.trim()
    && params.uri.trim(),
  );

  return useQuery({
    ...mcpResourceQueryOptions(effectiveParams),
    enabled,
  });
}
