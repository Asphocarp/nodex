import { Visitor } from "oxc-parser";
import { parseTypeScriptSource, sourcePosition } from "../lib/oxc-source";

export interface SemanticMigrationPolicy {
  readonly path: string;
  readonly forbiddenClassNames: readonly string[];
}

export interface SemanticMigrationViolation {
  readonly className: string;
  readonly line: number;
  readonly column: number;
}

const collectClassTokens = (value: string): readonly string[] => value.split(/\s+/).filter(Boolean);

export const collectSemanticMigrationViolations = (
  sourceText: string,
  policy: SemanticMigrationPolicy,
): readonly SemanticMigrationViolation[] => {
  const sourceFile = parseTypeScriptSource(policy.path, sourceText);
  const forbidden = new Set(policy.forbiddenClassNames);
  const violations: SemanticMigrationViolation[] = [];

  const collectViolations = (value: string, offset: number): void => {
    const matches = collectClassTokens(value).filter((className) => forbidden.has(className));
    if (matches.length === 0) return;

    const position = sourcePosition(sourceText, offset);
    violations.push(
      ...matches.map((className) => ({
        className,
        line: position.line,
        column: position.column,
      })),
    );
  };

  new Visitor({
    Literal(node) {
      if (typeof node.value !== "string") return;
      collectViolations(node.value, node.start);
    },
    TemplateLiteral(node) {
      if (node.expressions.length > 0) return;
      const value = node.quasis[0]?.value.cooked;
      if (value === null || value === undefined) return;
      collectViolations(value, node.start);
    },
  }).visit(sourceFile);
  return violations;
};
