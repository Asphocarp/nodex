import type { ProtocolAppInfo } from "./types";

const APP_ICON_ASSET_KEY = "256_square";

function selectCodexAppLogoUrls(app: ProtocolAppInfo): {
  logoUrl: string | null;
  logoUrlDark: string | null;
} {
  const lightAsset = app.iconAssets?.[APP_ICON_ASSET_KEY];
  const darkAsset = app.iconDarkAssets?.[APP_ICON_ASSET_KEY];
  if (lightAsset == null && darkAsset == null) {
    return {
      logoUrl: app.logoUrl,
      logoUrlDark: app.logoUrlDark,
    };
  }

  const logoUrl = lightAsset ?? app.logoUrl ?? darkAsset ?? app.logoUrlDark;
  return {
    logoUrl,
    logoUrlDark: darkAsset ?? app.logoUrlDark ?? lightAsset ?? logoUrl,
  };
}

function normalizeCodexAppLogoUrl(
  logoUrl: string | null,
  installUrl: string | null,
): string | null {
  const normalizedLogoUrl = logoUrl?.trim();
  if (!normalizedLogoUrl) return null;
  if (!normalizedLogoUrl.startsWith("/")) return normalizedLogoUrl;

  const normalizedInstallUrl = installUrl?.trim();
  if (!normalizedInstallUrl) return normalizedLogoUrl;
  try {
    return new URL(normalizedLogoUrl, normalizedInstallUrl).toString();
  } catch {
    return normalizedLogoUrl;
  }
}

/** Exact app-list logo projection; returns the original array when no row changes. */
export function normalizeCodexAppInfoLogos(
  apps: ProtocolAppInfo[],
): ProtocolAppInfo[] {
  let changed = false;
  const normalizedApps = apps.map((app) => {
    const selected = selectCodexAppLogoUrls(app);
    const logoUrl = normalizeCodexAppLogoUrl(selected.logoUrl, app.installUrl);
    const logoUrlDark = normalizeCodexAppLogoUrl(selected.logoUrlDark, app.installUrl);
    if (logoUrl === app.logoUrl && logoUrlDark === app.logoUrlDark) return app;

    changed = true;
    return {
      ...app,
      logoUrl,
      logoUrlDark,
    };
  });
  return changed ? normalizedApps : apps;
}
