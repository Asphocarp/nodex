import {
  CONTRACT_NODEX_OWNED_PROPERTIES,
  CONTRACT_VALUE_NORMALIZATIONS,
  CONTRACT_DECLARATION_PREFIXES,
  ELECTRON_BODY_PROPERTIES,
  FOUNDATION_BROWSER_OVERRIDES,
  FOUNDATION_ELECTRON_OVERRIDES,
  FOUNDATION_ROOT_FALLBACKS,
  FOUNDATION_SOURCE_SELECTORS,
  FOUNDATION_THEME_NORMALIZATIONS,
  FOUNDATION_THEME_PROPERTIES,
  LEGACY_UTILITY_SELECTORS,
  ROOT_FOUNDATION_PROPERTIES,
  SEMANTIC_THEME_ARTIFACT_PATHS,
  SEMANTIC_UTILITY_PROFILE,
  SURFACE_VALUE_REPLACEMENTS,
  SURFACE_SELECTORS,
  UTILITY_VALUE_REPLACEMENTS,
} from "./profile";
import {
  assertExportSafeCss,
  collectSemanticThemeCssFacts,
  collectSelectorFingerprints,
  contextWithoutConditions,
  contextWithinSupports,
  customPropertyName,
  extractCustomPropertyMap,
  extractDeclarations,
  extractDeclarationsByPrefix,
  filterCss,
} from "./parser";
import type {
  SemanticThemeArtifact,
  SemanticThemeGeneratedContract,
  SemanticThemeTarget,
} from "./types";

const RUNTIME_VSCODE_OVERRIDES = new Map<string, string>([
  ["--vscode-font-weight", "445"],
  ["--vscode-errorForeground", "var(--destructive)"],
  ["--vscode-textCodeBlock-background", "var(--color-background-button-secondary)"],
]);

const RUNTIME_TOKEN_AUGMENTATIONS = new Map<string, string>([
  [
    "--color-token-border-heavy",
    "var(--color-border-heavy, color-mix(in oklab, var(--vscode-foreground) 12%, transparent))",
  ],
  [
    "--color-token-conversation-header",
    "color-mix(in oklab, var(--color-token-foreground) 30%, transparent)",
  ],
  [
    "--color-token-conversation-body",
    "color-mix(in oklab, var(--color-token-foreground) 60%, transparent)",
  ],
  [
    "--color-token-non-assistant-body-descendant",
    "color-mix(in oklab, var(--color-token-foreground) 50%, transparent)",
  ],
  [
    "--color-token-conversation-summary-leading",
    "color-mix(in oklab, var(--color-token-description-foreground) 90%, transparent)",
  ],
  [
    "--color-token-conversation-summary-trailing",
    "color-mix(in oklab, var(--color-token-foreground) 40%, transparent)",
  ],
]);

const HEADER = (refVersion: string): string => `/*
 * Generated semantic theme contract (refVersion ${refVersion}).
 * Do not edit by hand. Run:
 *   pnpm run semantic-theme:sync -- --source /temporary/reference.css --ref-version ${refVersion}
 */`;

const formatDeclarations = (declarations: ReadonlyMap<string, string>): string =>
  [...declarations.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => `  ${name}: ${value};`)
    .join("\n");

const formatBlock = (selector: string, declarations: ReadonlyMap<string, string>): string =>
  declarations.size === 0 ? "" : `${selector} {\n${formatDeclarations(declarations)}\n}`;

const formatThemeBlock = (declarations: ReadonlyMap<string, string>): string =>
  declarations.size === 0 ? "" : `@theme static {\n${formatDeclarations(declarations)}\n}`;

const mergeMaps = (...maps: readonly ReadonlyMap<string, string>[]): Map<string, string> => {
  const result = new Map<string, string>();
  for (const map of maps) {
    for (const [name, value] of map) result.set(name, value);
  }
  return result;
};

const applyValues = (
  target: Map<string, string>,
  values: Readonly<Record<string, string>>,
): void => {
  for (const [name, value] of Object.entries(values)) target.set(name, value);
};

const extractFromCandidates = (
  sourceCss: string,
  selectors: readonly string[],
  properties: readonly string[],
  contextPredicate = contextWithoutConditions,
): Map<string, string> =>
  mergeMaps(
    ...selectors.map((selector) =>
      extractDeclarations(sourceCss, [selector], properties, contextPredicate),
    ),
  );

const renderFoundation = (sourceCss: string, refVersion: string): string => {
  const theme = extractFromCandidates(
    sourceCss,
    FOUNDATION_SOURCE_SELECTORS.theme,
    FOUNDATION_THEME_PROPERTIES,
  );
  applyValues(theme, FOUNDATION_THEME_NORMALIZATIONS);

  const root = extractFromCandidates(
    sourceCss,
    FOUNDATION_SOURCE_SELECTORS.root,
    ROOT_FOUNDATION_PROPERTIES,
  );
  applyValues(root, FOUNDATION_ROOT_FALLBACKS);

  const electronBody = extractFromCandidates(
    sourceCss,
    FOUNDATION_SOURCE_SELECTORS.electronBody,
    ELECTRON_BODY_PROPERTIES,
  );
  applyValues(electronBody, FOUNDATION_ELECTRON_OVERRIDES);
  const browser = extractFromCandidates(sourceCss, FOUNDATION_SOURCE_SELECTORS.browser, [
    "--height-toolbar",
  ]);
  applyValues(browser, FOUNDATION_BROWSER_OVERRIDES);
  const extension = extractFromCandidates(sourceCss, FOUNDATION_SOURCE_SELECTORS.extension, [
    "--diffs-font-size",
    "--text-heading-md",
  ]);

  return [
    HEADER(refVersion),
    formatThemeBlock(theme),
    formatBlock(":root", root),
    formatBlock('[data-codex-window-type="electron"] body', electronBody),
    formatBlock('[data-codex-window-type="browser"]', browser),
    formatBlock(':root[data-codex-window-type="extension"]', extension),
  ]
    .filter(Boolean)
    .join("\n\n")
    .concat("\n");
};

const renderContract = (sourceCss: string, refVersion: string): string => {
  const rootVscode = extractDeclarationsByPrefix(
    sourceCss,
    [":root, :host"],
    ["--vscode-"],
    contextWithoutConditions,
  );
  const electronVscode = mergeMaps(
    extractDeclarationsByPrefix(sourceCss, [".app-theme"], ["--vscode-"], contextWithoutConditions),
    extractDeclarationsByPrefix(
      sourceCss,
      ['[data-codex-window-type="electron"]'],
      ["--vscode-"],
      contextWithoutConditions,
    ),
  );
  for (const [name, value] of RUNTIME_VSCODE_OVERRIDES) electronVscode.set(name, value);

  const theme = extractDeclarationsByPrefix(
    sourceCss,
    [":root, :host"],
    CONTRACT_DECLARATION_PREFIXES,
    contextWithoutConditions,
  );
  for (const name of CONTRACT_NODEX_OWNED_PROPERTIES) theme.delete(name);
  applyValues(theme, CONTRACT_VALUE_NORMALIZATIONS);
  for (const [name, value] of RUNTIME_TOKEN_AUGMENTATIONS) theme.set(name, value);

  const conditional = filterCss(sourceCss, {
    selectorFingerprints: collectSelectorFingerprints([":root, :host"]),
    styleContextPredicate: contextWithinSupports,
    declarationPredicate: (declaration) => {
      const name = customPropertyName(declaration);
      return (
        name !== null &&
        CONTRACT_DECLARATION_PREFIXES.some((prefix) => name.startsWith(prefix)) &&
        !CONTRACT_NODEX_OWNED_PROPERTIES.has(name)
      );
    },
  });
  const lightDarkControls = filterCss(sourceCss, {
    selectorFingerprints: collectSelectorFingerprints([
      ".electron-dark",
      ".electron-light",
      ".\\[color-scheme\\:light\\]",
    ]),
    declarationPredicate: (declaration) => {
      const name = customPropertyName(declaration);
      return name === "--lightningcss-light" || name === "--lightningcss-dark";
    },
  });

  return [
    HEADER(refVersion),
    formatBlock(":root, :host", rootVscode),
    formatBlock('[data-codex-window-type="electron"]', electronVscode),
    formatThemeBlock(theme),
    lightDarkControls,
    conditional,
  ]
    .filter(Boolean)
    .join("\n\n")
    .concat("\n");
};

const UTILITY_PROPERTY_RULES = new Set([
  "--top-fade",
  "--bottom-fade",
  "--edge-fade-distance",
  "--left-fade",
  "--right-fade",
]);

const UTILITY_KEYFRAMES = new Set([
  "edge-fade",
  "edge-fade-top",
  "edge-fade-bottom",
  "edge-fade-horizontal",
]);

const renderUtilities = (sourceCss: string, refVersion: string): string => {
  const selectors = [
    ...LEGACY_UTILITY_SELECTORS,
    ...SEMANTIC_UTILITY_PROFILE.map((utility) => utility.selector),
  ];
  let css = filterCss(sourceCss, {
    selectorFingerprints: collectSelectorFingerprints(selectors),
    keepKeyframes: UTILITY_KEYFRAMES,
    keepPropertyRules: UTILITY_PROPERTY_RULES,
  });

  for (const utility of SEMANTIC_UTILITY_PROFILE) {
    if (!utility.outputSelector) continue;
    css = css.split(utility.selector).join(utility.outputSelector);
  }
  for (const [source, replacement] of Object.entries(UTILITY_VALUE_REPLACEMENTS)) {
    css = css.split(source).join(replacement);
  }

  if (!css.includes(".px-toolbar")) {
    css += `\n\n.px-toolbar {\n  padding-inline: var(--padding-toolbar);\n}`;
  }

  return `${HEADER(refVersion)}\n\n${css.trim()}\n`;
};

const SIDEBAR_SURFACE = `[data-codex-window-type="electron"]:not([data-codex-window-chrome="application-menu"]) .app-shell-left-panel {
  background: var(--color-token-editor-background);
  overflow: visible;
}

@supports (color: color-mix(in lab, red, red)) {
  [data-codex-window-type="electron"]:not([data-codex-window-chrome="application-menu"]) .app-shell-left-panel {
    background: color-mix(in srgb, var(--color-token-editor-background) 55%, transparent);
  }
}

[data-codex-window-type="electron"]:not([data-codex-window-chrome="application-menu"]) .app-shell-left-panel::after {
  inset: 0 calc(-1 * var(--radius-2xl)) 0 auto;
  width: var(--radius-2xl);
  background: inherit;
  content: "";
  pointer-events: none;
  position: absolute;
}`;

const renderSurfaces = (sourceCss: string, refVersion: string): string => {
  let extracted = filterCss(sourceCss, {
    selectorFingerprints: collectSelectorFingerprints(SURFACE_SELECTORS),
    keepKeyframes: new Set(["loading-shimmer"]),
  });
  for (const [source, replacement] of Object.entries(SURFACE_VALUE_REPLACEMENTS)) {
    extracted = extracted.split(source).join(replacement);
  }
  return `${HEADER(refVersion)}\n\n${extracted.trim()}\n\n${SIDEBAR_SURFACE}\n`;
};

const countPrefixDeclarations = (css: string, prefix: string): number =>
  [...extractCustomPropertyMap(css).keys()].filter((name) => name.startsWith(prefix)).length;

const renderManifest = (
  refVersion: string,
  artifacts: readonly SemanticThemeArtifact[],
): string => {
  const contractCss =
    artifacts.find((artifact) => artifact.path === SEMANTIC_THEME_ARTIFACT_PATHS.contract)
      ?.content ?? "";
  const manifest: SemanticThemeGeneratedContract = {
    schemaVersion: 1,
    refVersion,
    families: ["--vscode-", ...CONTRACT_DECLARATION_PREFIXES].map((prefix) => ({
      prefix,
      declarationCount: countPrefixDeclarations(contractCss, prefix),
    })),
    utilities: SEMANTIC_UTILITY_PROFILE.map((utility) => ({
      id: utility.id,
      selector: utility.outputSelector ?? utility.selector,
      dependencies: [...utility.tokenDependencies],
    })),
    variables: [
      ...artifacts
        .filter((artifact) => artifact.path.endsWith(".css"))
        .flatMap(
          (artifact) => collectSemanticThemeCssFacts(artifact.content, artifact.path).definitions,
        )
        .reduce(
          (variables, definition) => {
            const current = variables.get(definition.name) ?? {
              dependencies: new Set<string>(),
              owners: new Set<string>(),
              scopes: new Set<SemanticThemeTarget>(),
            };
            for (const reference of definition.references) current.dependencies.add(reference.name);
            current.owners.add(definition.artifactPath);
            for (const target of definition.targets) current.scopes.add(target);
            variables.set(definition.name, current);
            return variables;
          },
          new Map<
            string,
            {
              dependencies: Set<string>;
              owners: Set<string>;
              scopes: Set<SemanticThemeTarget>;
            }
          >(),
        ),
    ]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, value]) => ({
        name,
        scopes: [...value.scopes].sort(),
        dependencies: [...value.dependencies].sort(),
        owners: [...value.owners].sort(),
      })),
    artifacts: artifacts.map((artifact) => artifact.path),
  };
  return `${JSON.stringify(manifest, null, 2)}\n`;
};

export const renderSemanticThemeArtifacts = (
  sourceCss: string,
  refVersion: string,
): readonly SemanticThemeArtifact[] => {
  const cssArtifacts: SemanticThemeArtifact[] = [
    {
      path: SEMANTIC_THEME_ARTIFACT_PATHS.foundation,
      content: renderFoundation(sourceCss, refVersion),
    },
    {
      path: SEMANTIC_THEME_ARTIFACT_PATHS.contract,
      content: renderContract(sourceCss, refVersion),
    },
    {
      path: SEMANTIC_THEME_ARTIFACT_PATHS.utilities,
      content: renderUtilities(sourceCss, refVersion),
    },
    {
      path: SEMANTIC_THEME_ARTIFACT_PATHS.surfaces,
      content: renderSurfaces(sourceCss, refVersion),
    },
  ];

  for (const artifact of cssArtifacts) {
    assertExportSafeCss(artifact.content);
  }

  const manifest: SemanticThemeArtifact = {
    path: SEMANTIC_THEME_ARTIFACT_PATHS.manifest,
    content: renderManifest(refVersion, cssArtifacts),
  };
  return [...cssArtifacts, manifest];
};
