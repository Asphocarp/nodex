import type { ProtocolAppInfo } from "@/lib/types";

export interface CodexSetupContextSource {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly logoUrl: string | null;
  readonly logoUrlDark: string | null;
  readonly connected: boolean;
}

const FALLBACK_SOURCES = [
  { id: "google-drive", description: "Find launch docs and source material" },
  { id: "slack", description: "Read decisions and team context" },
  { id: "gmail", description: "Read customer and sales threads" },
] as const;

export function normalizeCodexSetupSourceAlias(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

function appAliases(app: ProtocolAppInfo): string[] {
  const aliases = [
    app.id,
    normalizeCodexSetupSourceAlias(app.id),
    normalizeCodexSetupSourceAlias(app.name),
    ...app.pluginDisplayNames.map(normalizeCodexSetupSourceAlias),
  ];
  if (app.id.startsWith("connector_")) {
    aliases.push(normalizeCodexSetupSourceAlias(app.id.slice("connector_".length)));
  }
  return Array.from(new Set(aliases.filter(Boolean)));
}

function buildConnectedAppIndex(apps: readonly ProtocolAppInfo[]): Map<string, ProtocolAppInfo> {
  const index = new Map<string, ProtocolAppInfo>();
  for (const app of apps) {
    for (const alias of appAliases(app)) {
      if (!index.has(alias)) index.set(alias, app);
    }
  }
  return index;
}

function findConnectedApp(
  index: ReadonlyMap<string, ProtocolAppInfo>,
  candidates: readonly string[],
): ProtocolAppInfo | null {
  for (const candidate of candidates) {
    const app = index.get(candidate) ?? index.get(normalizeCodexSetupSourceAlias(candidate));
    if (app) return app;
  }
  return null;
}

function projectConnectedApp(app: ProtocolAppInfo): CodexSetupContextSource {
  return {
    id: app.id,
    name: app.name,
    description: app.description,
    logoUrl: app.logoUrl,
    logoUrlDark: app.logoUrlDark,
    connected: true,
  };
}

export function resolveCodexSetupFallbackSources(
  apps: readonly ProtocolAppInfo[],
): CodexSetupContextSource[] {
  const index = buildConnectedAppIndex(apps);
  return FALLBACK_SOURCES.flatMap((fallback) => {
    const app = findConnectedApp(index, [fallback.id]);
    if (!app) return [];
    return [{
      ...projectConnectedApp(app),
      id: fallback.id,
      description: fallback.description,
    }];
  });
}

export function resolveCodexSetupBrowseSources(
  apps: readonly ProtocolAppInfo[],
  query: string,
): CodexSetupContextSource[] {
  const normalizedQuery = normalizeCodexSetupSourceAlias(query);
  return apps
    .filter((app) => {
      if (!normalizedQuery) return true;
      return [app.id, app.name, app.description ?? "", ...app.pluginDisplayNames]
        .some((value) => normalizeCodexSetupSourceAlias(value).includes(normalizedQuery));
    })
    .map(projectConnectedApp);
}

export function buildCodexSetupSelectedSourceIds(
  selectedIds: readonly string[],
  recommendedSources: readonly CodexSetupContextSource[],
): string[] {
  return Array.from(new Set([
    ...selectedIds,
    ...recommendedSources.flatMap((source) => source.connected ? [source.id] : []),
  ]));
}
