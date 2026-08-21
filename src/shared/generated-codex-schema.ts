import { z } from "zod";

type JsonSchemaInput = Parameters<typeof z.fromJSONSchema>[0];

function isGeneratedJsonSchema(value: unknown): value is JsonSchemaInput {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return "$schema" in value && typeof value.$schema === "string";
}

/**
 * Contains the single reviewed type assertion between generated JSON Schema
 * artifacts and the matching generated TypeScript bindings.
 */
export function createGeneratedCodexSchema<T>(artifact: unknown): z.ZodType<T> {
  if (!isGeneratedJsonSchema(artifact)) {
    throw new Error("Invalid generated Codex JSON Schema artifact.");
  }

  return z.fromJSONSchema(artifact, { defaultTarget: "draft-7" }) as z.ZodType<T>;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function collectStringDiscriminatorValues(
  value: unknown,
  discriminator: string,
  result: Set<string>,
): void {
  if (Array.isArray(value)) {
    for (const entry of value) collectStringDiscriminatorValues(entry, discriminator, result);
    return;
  }
  if (!isRecord(value)) return;

  const properties = value.properties;
  if (isRecord(properties)) {
    const discriminatorSchema = properties[discriminator];
    if (isRecord(discriminatorSchema)) {
      if (typeof discriminatorSchema.const === "string") {
        result.add(discriminatorSchema.const);
      }
      if (Array.isArray(discriminatorSchema.enum)) {
        for (const entry of discriminatorSchema.enum) {
          if (typeof entry === "string") result.add(entry);
        }
      }
    }
  }

  for (const entry of Object.values(value)) {
    collectStringDiscriminatorValues(entry, discriminator, result);
  }
}

export function generatedCodexStringDiscriminatorValues(
  artifact: unknown,
  discriminator: string,
): ReadonlySet<string> {
  const result = new Set<string>();
  collectStringDiscriminatorValues(artifact, discriminator, result);
  return result;
}

export function createGeneratedCodexStringDiscriminatorSchema<T extends string>(
  artifact: unknown,
  discriminator: string,
): z.ZodType<T> {
  const values = generatedCodexStringDiscriminatorValues(artifact, discriminator);
  if (values.size === 0) {
    throw new Error(`Generated Codex schema has no '${discriminator}' discriminator values.`);
  }

  return z.string().refine((value): value is T => values.has(value), {
    message: `Unknown generated Codex '${discriminator}' discriminator`,
  });
}
