export type SemanticThemeScope =
  | "root"
  | "light"
  | "dark"
  | "electron"
  | "browser"
  | "extension"
  | "supports"
  | "media";

export type SemanticThemeTarget =
  | "electron-light"
  | "electron-dark"
  | "browser-light"
  | "browser-dark"
  | "extension-light"
  | "extension-dark";

export interface SemanticThemeVariableReference {
  readonly name: string;
  readonly hasFallback: boolean;
}

export interface SemanticThemeVariableDefinition {
  readonly name: string;
  readonly artifactPath: string;
  readonly condition: "base" | "supports" | "media";
  readonly scopeKind: "root" | "scoped" | "local";
  readonly selectorKey: string;
  readonly targets: readonly SemanticThemeTarget[];
  readonly valueKey: string;
  readonly references: readonly SemanticThemeVariableReference[];
}

export interface SemanticThemeVariableUse {
  readonly artifactPath: string;
  readonly condition: "base" | "supports" | "media";
  readonly ownerName?: string;
  readonly selectorKey: string;
  readonly targets: readonly SemanticThemeTarget[];
  readonly reference: SemanticThemeVariableReference;
}

export interface SemanticThemeCssFacts {
  readonly definitions: readonly SemanticThemeVariableDefinition[];
  readonly uses: readonly SemanticThemeVariableUse[];
}

export type SemanticThemeDiagnosticSeverity = "info" | "warning" | "error";

export interface SemanticThemeDiagnostic {
  readonly code: string;
  readonly severity: SemanticThemeDiagnosticSeverity;
  readonly message: string;
  readonly subject?: string;
}

export interface SemanticThemeArtifactIdentity {
  readonly path: string;
  readonly sha256: string;
}

export interface SemanticThemeProvenance {
  readonly schemaVersion: 1;
  readonly refVersion: string;
  readonly profileSha256: string;
  readonly generatorVersion: number;
  readonly artifacts: readonly SemanticThemeArtifactIdentity[];
}

export type SemanticThemeCollisionResolution =
  | { readonly kind: "generated-owner" }
  | { readonly kind: "nodex-owner"; readonly reason: string }
  | { readonly kind: "alias"; readonly target: string }
  | { readonly kind: "scoped-override"; readonly reason: string }
  | { readonly kind: "remove-duplicate" };

export interface SemanticUtilityProfile {
  readonly id: string;
  readonly selector: string;
  readonly tokenDependencies: readonly string[];
  readonly collisionStrategy: "exact" | "collision-safe-alias";
  readonly outputSelector?: string;
  readonly consumers: readonly string[];
}

export type SemanticThemeCommand =
  | { readonly kind: "audit"; readonly sourcePath: string; readonly refVersion: string }
  | { readonly kind: "sync"; readonly sourcePath: string; readonly refVersion: string }
  | { readonly kind: "verify"; readonly sourcePath?: string }
  | { readonly kind: "verify-build"; readonly buildCssPath?: string };

export interface SemanticThemeCommandResult {
  readonly ok: boolean;
  readonly mode: "audit" | "sync" | "verify-source-free" | "verify-source-aware" | "verify-build";
  readonly diagnostics: readonly SemanticThemeDiagnostic[];
  readonly changedArtifacts: readonly string[];
  readonly auditReport?: SemanticThemeAuditReport;
}

export interface SemanticThemeAuditChangeSet {
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly changed: readonly string[];
}

export interface SemanticThemeExclusionProfile {
  readonly scope: string;
  readonly declarationPattern: string;
  readonly reason: string;
  readonly consumerStatus: "unsupported" | "not-used";
}

export interface SemanticThemeAuditReport {
  readonly schemaVersion: 1;
  readonly refVersion: string;
  readonly artifacts: readonly string[];
  readonly declarations: SemanticThemeAuditChangeSet;
  readonly utilities: SemanticThemeAuditChangeSet;
  readonly selectors: SemanticThemeAuditChangeSet;
  readonly dependencies: SemanticThemeAuditChangeSet;
  readonly collisionResolutions: readonly string[];
  readonly exclusions: readonly SemanticThemeExclusionProfile[];
}

export interface SemanticThemeArtifact {
  readonly path: string;
  readonly content: string;
}

export interface SemanticThemeGeneratedContract {
  readonly schemaVersion: 1;
  readonly refVersion: string;
  readonly families: readonly {
    readonly prefix: string;
    readonly declarationCount: number;
  }[];
  readonly utilities: readonly {
    readonly id: string;
    readonly selector: string;
    readonly dependencies: readonly string[];
  }[];
  readonly variables: readonly {
    readonly name: string;
    readonly scopes: readonly SemanticThemeTarget[];
    readonly dependencies: readonly string[];
    readonly owners: readonly string[];
  }[];
  readonly artifacts: readonly string[];
}
