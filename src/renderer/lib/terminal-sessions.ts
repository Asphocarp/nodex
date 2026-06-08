// In-memory only; survives tab switching within a session.
const panelHeights = new Map<string, number>();

const DEFAULT_PANEL_HEIGHT = 260;

export function getPanelHeight(terminalId: string): number {
  return panelHeights.get(terminalId) ?? DEFAULT_PANEL_HEIGHT;
}

export function setPanelHeight(terminalId: string, height: number): void {
  panelHeights.set(terminalId, height);
}
