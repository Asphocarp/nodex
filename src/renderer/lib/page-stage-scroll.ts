const STORAGE_KEY = "nodex-page-stage-scroll-v1";
const MAX_ENTRIES = 200;

type ScrollMap = Record<string, number>;
const hotScrollPositions = new Map<string, number>();

function makeKey(
  projectId: string,
  pageId: string,
  editorSessionKey?: string,
): string {
  if (editorSessionKey) return `page-stage-session:${editorSessionKey}`;
  return `page-stage:${projectId}:${pageId}`;
}

function readMap(): ScrollMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    const result: ScrollMap = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "number" && v >= 0) result[k] = v;
    }
    return result;
  } catch {
    return {};
  }
}

function writeMap(map: ScrollMap): void {
  try {
    const keys = Object.keys(map);
    if (keys.length > MAX_ENTRIES) {
      for (const k of keys.slice(0, keys.length - MAX_ENTRIES)) delete map[k];
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // localStorage may be unavailable
  }
}

function rememberHotScrollPosition(key: string, scrollTop: number): void {
  hotScrollPositions.delete(key);
  hotScrollPositions.set(key, scrollTop);
  while (hotScrollPositions.size > MAX_ENTRIES) {
    const oldestKey = hotScrollPositions.keys().next().value;
    if (typeof oldestKey !== "string") return;
    hotScrollPositions.delete(oldestKey);
  }
}

export function rememberScrollPosition(
  projectId: string,
  pageId: string,
  scrollTop: number,
  editorSessionKey?: string,
): void {
  rememberHotScrollPosition(
    makeKey(projectId, pageId, editorSessionKey),
    scrollTop,
  );
}

export function saveScrollPosition(
  projectId: string,
  pageId: string,
  scrollTop: number,
  editorSessionKey?: string,
): void {
  rememberScrollPosition(projectId, pageId, scrollTop, editorSessionKey);
  const map = readMap();
  map[makeKey(projectId, pageId, editorSessionKey)] = scrollTop;
  writeMap(map);
}

export function loadScrollPosition(
  projectId: string,
  pageId: string,
  editorSessionKey?: string,
): number | null {
  const key = makeKey(projectId, pageId, editorSessionKey);
  const hotValue = hotScrollPositions.get(key);
  if (typeof hotValue === "number") return hotValue;

  const map = readMap();
  return map[key] ?? null;
}

export function forgetScrollPosition(
  projectId: string,
  pageId: string,
  editorSessionKey?: string,
): void {
  const key = makeKey(projectId, pageId, editorSessionKey);
  hotScrollPositions.delete(key);

  const map = readMap();
  delete map[key];
  writeMap(map);
}
