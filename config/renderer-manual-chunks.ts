const rendererChunkRules = [
  {
    chunkName: "vendor-react",
    packageFragments: [
      "/node_modules/react/",
      "/node_modules/react-dom/",
      "/node_modules/scheduler/",
    ],
  },
  {
    chunkName: "vendor-editor-markdown",
    packageFragments: [
      "/node_modules/streamdown/",
      "/node_modules/@streamdown/",
      "/third_party/blocknote/packages/",
      "/node_modules/@blocknote/",
      "/node_modules/@tiptap/",
      "/node_modules/prosemirror-",
      "/node_modules/y-prosemirror/",
      "/node_modules/orderedmap/",
      "/node_modules/crelt/",
      "/node_modules/rope-sequence/",
    ],
  },
  {
    chunkName: "vendor-excalidraw",
    packageFragments: ["/node_modules/@excalidraw/excalidraw/"],
  },
  {
    chunkName: "vendor-cytoscape",
    packageFragments: ["/node_modules/cytoscape/", "/node_modules/cytoscape-cose-bilkent/"],
  },
] as const;

export function resolveRendererManualChunk(id: string): string | undefined {
  const normalizedId = id.replaceAll("\\", "/");

  for (const rule of rendererChunkRules) {
    if (rule.packageFragments.some((fragment) => normalizedId.includes(fragment))) {
      return rule.chunkName;
    }
  }

  return undefined;
}
