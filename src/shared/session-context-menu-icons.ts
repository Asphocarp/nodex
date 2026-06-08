import type { NativeContextMenuIconKey } from "./native-context-menu";

export const SESSION_CONTEXT_MENU_ICON_SVG_BY_KEY: Record<NativeContextMenuIconKey, string> = {
  pin: '<path d="M10.9 1.1 14.9 5.1 12.8 7.2 15 12.5 12.5 15 7.2 12.8 3.6 16.4 2.6 15.4 6.2 11.8 4 6.5 6.5 4 10.9 1.1Z"/>',
  unpin: '<path d="M2 2 14 14M10.9 1.1 14.9 5.1 12.8 7.2 15 12.5 12.5 15 7.2 12.8 3.6 16.4"/>',
  rename: '<path d="M3 13.5 3.8 10.1 11.9 2 15 5.1 6.9 13.2 3 13.5ZM10.8 3.1 13.9 6.2"/>',
  archive: '<path d="M2.5 5.5H15.5M4 5.5V14.5H14V5.5M6.5 8.5H11.5M3.5 2.5H14.5V5.5H3.5V2.5Z"/>',
  unread: '<path d="M8.5 14.5A6 6 0 1 0 8.5 2.5a6 6 0 0 0 0 12ZM8.5 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z"/>',
  folder: '<path d="M2.5 5.5H7L8.5 7H15.5V14H2.5V5.5ZM2.5 5.5V3.5H7L8.5 5.5"/>',
  copy: '<path d="M6 6H15V15H6V6ZM3 3H12V4.5M3 3V12H4.5"/>',
  fork: '<path d="M5 3.5a1.5 1.5 0 1 0 0 3M5 6.5V10a3 3 0 0 0 3 3h2M11 4h1a2 2 0 0 1 2 2v1M12.5 2.5 14 4 12.5 5.5M11 11.5 12.5 13 11 14.5"/>',
  window: '<path d="M2.5 4.5H15.5V13.5H2.5V4.5ZM2.5 7H15.5M5 5.75H5.1M7 5.75H7.1"/>',
};

export function buildSessionContextMenuIconSvg(iconKey: NativeContextMenuIconKey): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="black" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${SESSION_CONTEXT_MENU_ICON_SVG_BY_KEY[iconKey]}</svg>`;
}
