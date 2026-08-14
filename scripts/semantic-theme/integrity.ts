import { collectSemanticThemeCssFacts } from "./parser";
import type {
  SemanticThemeArtifact,
  SemanticThemeDiagnostic,
  SemanticThemeTarget,
  SemanticThemeVariableDefinition,
  SemanticThemeVariableUse,
} from "./types";

export interface SemanticThemeRuntimeProvider {
  readonly name?: string;
  readonly prefix?: string;
  readonly targets: readonly SemanticThemeTarget[];
  readonly reason: string;
}

export interface SemanticThemeVariableRequirement {
  readonly name: string;
  readonly targets: readonly SemanticThemeTarget[];
}

export interface SemanticThemeIntegrityOptions {
  readonly collisionResolutions: Readonly<Record<string, unknown>>;
  readonly requiredVariables: readonly SemanticThemeVariableRequirement[];
  readonly runtimeProviders: readonly SemanticThemeRuntimeProvider[];
  readonly checkedOwnerNames?: ReadonlySet<string>;
  readonly checkedOwnerTargets?: ReadonlyMap<string, ReadonlySet<SemanticThemeTarget>>;
}

const diagnostic = (
  code: string,
  message: string,
  subject?: string,
): SemanticThemeDiagnostic => ({
  code,
  severity: "error",
  message,
  ...(subject ? { subject } : {}),
});

const targetsForDefinitions = (
  definitions: readonly SemanticThemeVariableDefinition[],
  use: SemanticThemeVariableUse,
): ReadonlySet<SemanticThemeTarget> => {
  const targets = new Set<SemanticThemeTarget>();
  for (const definition of definitions) {
    if (definition.condition !== "base" && definition.condition !== use.condition) continue;
    for (const target of definition.targets) targets.add(target);
  }
  return targets;
};

const runtimeProviderTargets = (
  name: string,
  providers: readonly SemanticThemeRuntimeProvider[],
): ReadonlySet<SemanticThemeTarget> => new Set(providers
  .filter((provider) => provider.name === name || (provider.prefix && name.startsWith(provider.prefix)))
  .flatMap((provider) => provider.targets));

const collectDependencyDiagnostics = (
  definitions: readonly SemanticThemeVariableDefinition[],
  uses: readonly SemanticThemeVariableUse[],
  options: SemanticThemeIntegrityOptions,
): readonly SemanticThemeDiagnostic[] => {
  const definitionsByName = new Map<string, SemanticThemeVariableDefinition[]>();
  for (const definition of definitions) {
    const entries = definitionsByName.get(definition.name) ?? [];
    entries.push(definition);
    definitionsByName.set(definition.name, entries);
  }

  const diagnostics: SemanticThemeDiagnostic[] = [];
  const seen = new Set<string>();
  for (const use of uses) {
    if (use.reference.hasFallback) continue;
    if (options.checkedOwnerNames && (!use.ownerName || !options.checkedOwnerNames.has(use.ownerName))) {
      continue;
    }
    const ownerTargets = use.ownerName
      ? options.checkedOwnerTargets?.get(use.ownerName)
      : undefined;
    const useTargets = ownerTargets
      ? use.targets.filter((target) => ownerTargets.has(target))
      : use.targets;
    const providedTargets = new Set<SemanticThemeTarget>([
      ...targetsForDefinitions(definitionsByName.get(use.reference.name) ?? [], use),
      ...runtimeProviderTargets(use.reference.name, options.runtimeProviders),
    ]);
    const missingTargets = useTargets.filter((target) => !providedTargets.has(target));
    if (missingTargets.length === 0) continue;
    const key = `${use.reference.name}:${missingTargets.join(",")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    diagnostics.push(diagnostic(
      "THEME_DEPENDENCY_SCOPE_UNRESOLVED",
      "A theme dependency is not provided in every supported window and color-scheme scope.",
      `${use.reference.name} [${missingTargets.join(", ")}]`,
    ));
  }
  return diagnostics;
};

const collectCollisionDiagnostics = (
  definitions: readonly SemanticThemeVariableDefinition[],
  options: SemanticThemeIntegrityOptions,
): readonly SemanticThemeDiagnostic[] => {
  const rootDefinitions = new Map<string, SemanticThemeVariableDefinition[]>();
  for (const definition of definitions) {
    if (definition.condition !== "base" || definition.scopeKind !== "root") continue;
    const entries = rootDefinitions.get(definition.name) ?? [];
    entries.push(definition);
    rootDefinitions.set(definition.name, entries);
  }

  const diagnostics: SemanticThemeDiagnostic[] = [];
  for (const [name, entries] of rootDefinitions) {
    const artifacts = new Set(entries.map((entry) => entry.artifactPath));
    const values = new Set(entries.map((entry) => entry.valueKey));
    if (artifacts.size < 2 || values.size < 2 || options.collisionResolutions[name]) continue;
    diagnostics.push(diagnostic(
      "THEME_COLLISION_UNOWNED",
      "A root theme property has multiple values without an explicit owner or alias decision.",
      `${name} [${[...artifacts].sort().join(", ")}]`,
    ));
  }
  return diagnostics;
};

const definitionForTarget = (
  definitions: readonly SemanticThemeVariableDefinition[],
  target: SemanticThemeTarget,
): SemanticThemeVariableDefinition | undefined => definitions
  .filter((definition) => definition.condition === "base"
    && definition.scopeKind !== "local"
    && definition.targets.includes(target))
  .sort((left, right) => {
    const scopeRank = (definition: SemanticThemeVariableDefinition): number =>
      definition.scopeKind === "scoped" ? 1 : 0;
    return scopeRank(left) - scopeRank(right);
  })
  .at(-1);

const cycleForTarget = (
  definitions: readonly SemanticThemeVariableDefinition[],
  target: SemanticThemeTarget,
): readonly string[] | null => {
  const byName = new Map<string, SemanticThemeVariableDefinition[]>();
  for (const definition of definitions) {
    const entries = byName.get(definition.name) ?? [];
    entries.push(definition);
    byName.set(definition.name, entries);
  }
  const graph = new Map<string, readonly string[]>();
  for (const [name, entries] of byName) {
    const winner = definitionForTarget(entries, target);
    if (winner) graph.set(name, winner.references.map((reference) => reference.name));
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const path: string[] = [];
  const visit = (name: string): readonly string[] | null => {
    if (visiting.has(name)) {
      const start = path.indexOf(name);
      return [...path.slice(start), name];
    }
    if (visited.has(name)) return null;
    visiting.add(name);
    path.push(name);
    for (const dependency of graph.get(name) ?? []) {
      const cycle = visit(dependency);
      if (cycle) return cycle;
    }
    path.pop();
    visiting.delete(name);
    visited.add(name);
    return null;
  };

  for (const name of graph.keys()) {
    const cycle = visit(name);
    if (cycle) return cycle;
  }
  return null;
};

const collectCycleDiagnostics = (
  definitions: readonly SemanticThemeVariableDefinition[],
): readonly SemanticThemeDiagnostic[] => {
  const diagnostics: SemanticThemeDiagnostic[] = [];
  const seen = new Set<string>();
  const targets = [
    "electron-light",
    "electron-dark",
    "browser-light",
    "browser-dark",
    "extension-light",
    "extension-dark",
  ] as const satisfies readonly SemanticThemeTarget[];
  for (const target of targets) {
    const cycle = cycleForTarget(definitions, target);
    if (!cycle) continue;
    const key = cycle.join(" -> ");
    if (seen.has(key)) continue;
    seen.add(key);
    diagnostics.push(diagnostic(
      "THEME_DEPENDENCY_CYCLE",
      "Theme custom properties form a dependency cycle.",
      `${target}: ${key}`,
    ));
  }
  return diagnostics;
};

const collectRequiredVariableDiagnostics = (
  definitions: readonly SemanticThemeVariableDefinition[],
  requiredVariables: readonly SemanticThemeVariableRequirement[],
): readonly SemanticThemeDiagnostic[] => {
  const definitionsByName = new Map<string, Set<SemanticThemeTarget>>();
  for (const definition of definitions) {
    if (definition.condition !== "base" || definition.scopeKind === "local") continue;
    const targets = definitionsByName.get(definition.name) ?? new Set<SemanticThemeTarget>();
    for (const target of definition.targets) targets.add(target);
    definitionsByName.set(definition.name, targets);
  }
  return requiredVariables.flatMap((requirement) => {
    const targets = definitionsByName.get(requirement.name) ?? new Set<SemanticThemeTarget>();
    const missingTargets = requirement.targets.filter((target) => !targets.has(target));
    if (missingTargets.length === 0) return [];
    return [diagnostic(
      "THEME_REQUIRED_VARIABLE_MISSING",
      "A required theme variable is absent from a supported consumer scope.",
      `${requirement.name} [${missingTargets.join(", ")}]`,
    )];
  });
};

const collectTransitiveDependencyDiagnostics = (
  definitions: readonly SemanticThemeVariableDefinition[],
  options: SemanticThemeIntegrityOptions,
): readonly SemanticThemeDiagnostic[] => {
  const definitionsByName = new Map<string, SemanticThemeVariableDefinition[]>();
  for (const definition of definitions) {
    const entries = definitionsByName.get(definition.name) ?? [];
    entries.push(definition);
    definitionsByName.set(definition.name, entries);
  }

  const diagnostics: SemanticThemeDiagnostic[] = [];
  const seen = new Set<string>();
  for (const requirement of options.requiredVariables) {
    for (const target of requirement.targets) {
      const visited = new Set<string>();
      const visit = (name: string, chain: readonly string[]): void => {
        if (visited.has(name)) return;
        visited.add(name);
        const runtimeTargets = runtimeProviderTargets(name, options.runtimeProviders);
        if (runtimeTargets.has(target)) return;
        const definition = definitionForTarget(definitionsByName.get(name) ?? [], target);
        if (!definition) {
          const key = `${target}:${name}:${chain.join("->")}`;
          if (seen.has(key)) return;
          seen.add(key);
          diagnostics.push(diagnostic(
            "THEME_DEPENDENCY_SCOPE_UNRESOLVED",
            "A transitive theme dependency is not provided in a supported consumer scope.",
            `${target}: ${[...chain, name].join(" -> ")}`,
          ));
          return;
        }
        for (const reference of definition.references) {
          if (reference.hasFallback) continue;
          visit(reference.name, [...chain, name]);
        }
      };
      visit(requirement.name, []);
    }
  }
  return diagnostics;
};

const CASCADE_PATH_ORDER = [
  "src/renderer/styles/theme-source.css",
  "src/renderer/styles/theme-extracted-foundation.generated.css",
  "src/renderer/styles/theme-semantic-contract.generated.css",
  "src/renderer/styles/theme-token-bridge.css",
  "src/renderer/styles/theme-semantic-utilities.generated.css",
  "src/renderer/styles/theme-utilities.css",
  "src/renderer/styles/theme-extracted-surfaces.generated.css",
  "src/renderer/styles/theme-surface.css",
] as const;

const sortArtifactsByCascade = (
  artifacts: readonly SemanticThemeArtifact[],
): readonly SemanticThemeArtifact[] => artifacts
  .map((artifact, index) => ({ artifact, index }))
  .sort((left, right) => {
    const leftRank = CASCADE_PATH_ORDER.indexOf(left.artifact.path as typeof CASCADE_PATH_ORDER[number]);
    const rightRank = CASCADE_PATH_ORDER.indexOf(right.artifact.path as typeof CASCADE_PATH_ORDER[number]);
    if (leftRank === -1 && rightRank === -1) return left.index - right.index;
    if (leftRank === -1) return 1;
    if (rightRank === -1) return -1;
    return leftRank - rightRank;
  })
  .map(({ artifact }) => artifact);

export const collectSemanticThemeIntegrityDiagnostics = (
  artifacts: readonly SemanticThemeArtifact[],
  providers: readonly SemanticThemeArtifact[],
  options: SemanticThemeIntegrityOptions,
): readonly SemanticThemeDiagnostic[] => {
  const artifactFacts = sortArtifactsByCascade([...artifacts, ...providers])
    .filter((artifact) => artifact.path.endsWith(".css"))
    .map((artifact) => collectSemanticThemeCssFacts(artifact.content, artifact.path));
  const definitions = artifactFacts.flatMap((facts) => facts.definitions);
  const artifactPaths = new Set(artifacts.map((artifact) => artifact.path));
  const uses = artifactFacts
    .flatMap((facts) => facts.uses)
    .filter((use) => artifactPaths.has(use.artifactPath));
  const checkedOwnerNames = options.checkedOwnerNames
    ?? new Set(options.requiredVariables.map((requirement) => requirement.name));
  const checkedOwnerTargets = options.checkedOwnerTargets ?? new Map(options.requiredVariables.map(
    (requirement) => [requirement.name, new Set(requirement.targets)] as const,
  ));

  return [
    ...collectRequiredVariableDiagnostics(definitions, options.requiredVariables),
    ...collectDependencyDiagnostics(definitions, uses, {
      ...options,
      checkedOwnerNames,
      checkedOwnerTargets,
    }),
    ...collectTransitiveDependencyDiagnostics(definitions, options),
    ...collectCollisionDiagnostics(definitions, options),
    ...collectCycleDiagnostics(definitions),
  ];
};
