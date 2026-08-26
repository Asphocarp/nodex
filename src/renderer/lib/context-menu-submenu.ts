/**
 * Interactive submenu content is not a MenuItem collection. When a flipped
 * submenu crosses its pointer-grace edge, focus can briefly return to the root
 * menu before the pointer reaches the submenu. Preserve that transition;
 * focus on another item or outside the menu still dismisses normally.
 */
export const preserveInteractiveSubmenuRootFocus = (event: Event): void => {
  if (!(event.target instanceof HTMLElement)) return;
  if (event.target.getAttribute("role") !== "menu") return;
  event.preventDefault();
};
