export interface BrowserPermissionRequestFacts {
  readonly permission: string;
  readonly isMainFrame: boolean;
}

export function shouldGrantBrowserPermission(facts: BrowserPermissionRequestFacts): boolean {
  return facts.isMainFrame && facts.permission === "clipboard-sanitized-write";
}
