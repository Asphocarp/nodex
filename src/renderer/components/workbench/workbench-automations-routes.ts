export const AUTOMATIONS_ROOT_PATH = "/automations";

export type WorkbenchAutomationsTab = "tasks" | "templates";
export type WorkbenchAutomationMode = "create";

export interface WorkbenchAutomationsRouteState {
  tab: WorkbenchAutomationsTab;
  automationId: string | null;
  automationMode: WorkbenchAutomationMode | null;
}

export interface BuildAutomationsPathInput {
  tab?: WorkbenchAutomationsTab | null;
  automationId?: string | null;
  automationMode?: WorkbenchAutomationMode | null;
}

function normalizeAutomationId(automationId: string | null | undefined): string | null {
  const normalized = automationId?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}

function normalizeAutomationMode(automationMode: WorkbenchAutomationMode | null | undefined): WorkbenchAutomationMode | null {
  return automationMode === "create" ? "create" : null;
}

function normalizeTab(tab: string | null | undefined): WorkbenchAutomationsTab {
  return tab === "templates" ? "templates" : "tasks";
}

export function buildAutomationsPath(input: BuildAutomationsPathInput = {}): string {
  const searchParams = new URLSearchParams();
  const tab = normalizeTab(input.tab ?? null);
  const automationId = normalizeAutomationId(input.automationId);
  const automationMode = normalizeAutomationMode(input.automationMode);

  if (tab === "templates") searchParams.set("tab", "templates");
  if (automationId) searchParams.set("automationId", automationId);
  if (automationMode) searchParams.set("automationMode", automationMode);

  const query = searchParams.toString();
  return query ? `${AUTOMATIONS_ROOT_PATH}?${query}` : AUTOMATIONS_ROOT_PATH;
}

export function resolveAutomationsRouteState(path: string): WorkbenchAutomationsRouteState {
  const queryStart = path.indexOf("?");
  const query = queryStart >= 0 ? path.slice(queryStart + 1) : "";
  const searchParams = new URLSearchParams(query);
  return {
    tab: normalizeTab(searchParams.get("tab")),
    automationId: normalizeAutomationId(searchParams.get("automationId")),
    automationMode: normalizeAutomationMode(searchParams.get("automationMode") as WorkbenchAutomationMode | null),
  };
}

export function updateAutomationsPath(
  currentPath: string,
  input: BuildAutomationsPathInput,
): string {
  const current = resolveAutomationsRouteState(currentPath);
  return buildAutomationsPath({
    tab: input.tab ?? current.tab,
    automationId: input.automationId === undefined ? current.automationId : input.automationId,
    automationMode: input.automationMode === undefined ? current.automationMode : input.automationMode,
  });
}
