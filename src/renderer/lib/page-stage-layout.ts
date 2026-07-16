const STORAGE_KEY = "nodex-page-stage-layout-v1";

interface PageStageLayoutPrefs {
  limitMainContentWidth?: boolean;
  showRawContent?: boolean;
}

function readPrefs(): PageStageLayoutPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};

    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) return {};

    const candidate = parsed as {
      limitMainContentWidth?: unknown;
      showRawContent?: unknown;
    };

    const prefs: PageStageLayoutPrefs = {};
    if (typeof candidate.limitMainContentWidth === "boolean") {
      prefs.limitMainContentWidth = candidate.limitMainContentWidth;
    }
    if (typeof candidate.showRawContent === "boolean") {
      prefs.showRawContent = candidate.showRawContent;
    }

    return prefs;
  } catch {
    return {};
  }
}

function writePrefs(prefs: PageStageLayoutPrefs): void {
  try {
    const nextPrefs = {
      ...readPrefs(),
      ...prefs,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextPrefs));
  } catch {
    // localStorage may be unavailable.
  }
}

export function readPageStageContentWidthPreference(): boolean {
  return readPrefs().limitMainContentWidth ?? true;
}

export function writePageStageContentWidthPreference(limitMainContentWidth: boolean): void {
  writePrefs({ limitMainContentWidth });
}

export function readPageStageShowRawContentPreference(): boolean {
  return readPrefs().showRawContent ?? false;
}

export function writePageStageShowRawContentPreference(showRawContent: boolean): void {
  writePrefs({ showRawContent });
}
