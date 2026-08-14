import ts from "typescript";

export interface SemanticMigrationPolicy {
  readonly path: string;
  readonly forbiddenClassNames: readonly string[];
}

export interface SemanticMigrationViolation {
  readonly className: string;
  readonly line: number;
  readonly column: number;
}

const collectClassTokens = (value: string): readonly string[] =>
  value.split(/\s+/).filter(Boolean);

export const collectSemanticMigrationViolations = (
  sourceText: string,
  policy: SemanticMigrationPolicy,
): readonly SemanticMigrationViolation[] => {
  const sourceFile = ts.createSourceFile(
    policy.path,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const forbidden = new Set(policy.forbiddenClassNames);
  const violations: SemanticMigrationViolation[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const matches = collectClassTokens(node.text).filter((className) => forbidden.has(className));
      if (matches.length > 0) {
        const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        violations.push(...matches.map((className) => ({
          className,
          line: position.line + 1,
          column: position.character + 1,
        })));
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return violations;
};
