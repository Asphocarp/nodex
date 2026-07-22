import {
  resolveDefaultSettingsSectionId,
  resolveVisibleSettingsSections,
  type SettingsSectionDefinition,
  type SettingsSectionId,
} from "./workbench-settings-sections";

export const SETTINGS_ROOT_PATH = "/settings";
export const OPEN_SOURCE_LICENSES_SETTINGS_PATH = "/settings/open-source-licenses";

export type SettingsDetailPageId = "open-source-licenses";

function normalizeSettingsPath(path: string | null | undefined): string {
  if (!path) {
    return SETTINGS_ROOT_PATH;
  }

  const [pathname] = path.split(/[?#]/, 1);
  if (!pathname) {
    return SETTINGS_ROOT_PATH;
  }

  if (pathname === "/settings/") {
    return SETTINGS_ROOT_PATH;
  }

  return pathname;
}

export function buildSettingsPath(sectionId: SettingsSectionId): string {
  return `${SETTINGS_ROOT_PATH}/${sectionId}`;
}

export function parseSettingsPath(path: string | null | undefined): SettingsSectionId | null {
  const normalizedPath = normalizeSettingsPath(path);
  if (normalizedPath === SETTINGS_ROOT_PATH) {
    return null;
  }

  if (!normalizedPath.startsWith(`${SETTINGS_ROOT_PATH}/`)) {
    return null;
  }

  const slug = normalizedPath.slice(`${SETTINGS_ROOT_PATH}/`.length);
  if (!slug) {
    return null;
  }

  return slug as SettingsSectionId;
}

export interface ResolvedSettingsShellState {
  activeSectionId: SettingsSectionId;
  detailPageId: SettingsDetailPageId | null;
  redirectPath: string | null;
  visibleSections: SettingsSectionDefinition[];
}

export function resolveSettingsShellState(
  path: string | null | undefined,
): ResolvedSettingsShellState {
  const visibleSections = resolveVisibleSettingsSections();
  const defaultSectionId = resolveDefaultSettingsSectionId(visibleSections);
  const normalizedPath = normalizeSettingsPath(path);
  const detailPageId = normalizedPath === OPEN_SOURCE_LICENSES_SETTINGS_PATH
    ? "open-source-licenses"
    : null;
  const requestedSectionId = detailPageId
    ? "general-settings"
    : parseSettingsPath(path);
  const activeSectionId = visibleSections.some((section) => section.id === requestedSectionId)
    ? (requestedSectionId as SettingsSectionId)
    : defaultSectionId;
  const canonicalPath = detailPageId
    ? OPEN_SOURCE_LICENSES_SETTINGS_PATH
    : buildSettingsPath(activeSectionId);
  const redirectPath = normalizedPath === canonicalPath ? null : canonicalPath;

  return {
    activeSectionId,
    detailPageId,
    redirectPath,
    visibleSections,
  };
}
