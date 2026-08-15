interface NfmLinkElementEditor {
  readonly prosemirrorView?: {
    posAtDOM(node: Node, offset: number): number;
  };
  getLinkMarkAtPos(position: number): { href?: unknown } | undefined;
}

/**
 * Reads the stored link mark instead of trusting the rendered anchor attribute.
 * Browsers clear unsupported protocols such as `nodex://` from BlockNote's DOM,
 * while the ProseMirror document still owns the canonical href.
 */
export function readNfmLinkHrefAtElement(
  editor: NfmLinkElementEditor,
  anchor: HTMLAnchorElement,
): string | undefined {
  const view = editor.prosemirrorView;
  if (view) {
    try {
      const link = editor.getLinkMarkAtPos(view.posAtDOM(anchor, 0) + 1);
      if (typeof link?.href === "string" && link.href.length > 0) {
        return link.href;
      }
    } catch {
      // A detached anchor can race a document update; use its rendered href below.
    }
  }

  const renderedHref = anchor.getAttribute("href");
  return renderedHref && renderedHref.length > 0 ? renderedHref : undefined;
}
