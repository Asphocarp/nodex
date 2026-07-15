import type { DynamicToolFunctionSpec } from "@nodex/codex-app-server-protocol/v2/DynamicToolFunctionSpec";
import type { DynamicToolSpec } from "@nodex/codex-app-server-protocol/v2/DynamicToolSpec";
import { z } from "zod";

export type DynamicToolEffect = "read" | "write" | "destructive";

export interface DynamicToolCatalogSelection {
  readonly namespace: string;
  readonly toolsetRevision: number;
}

export interface DynamicToolExecutionIdentity extends DynamicToolCatalogSelection {
  readonly tool: string;
}

export interface DynamicToolExecutionRequest<TInput, TContext> {
  readonly identity: DynamicToolExecutionIdentity;
  readonly input: TInput;
  readonly context: TContext;
}

export interface DynamicToolRegistration<
  TInputSchema extends z.ZodType,
  TOutputSchema extends z.ZodType,
  TContext,
> extends DynamicToolExecutionIdentity {
  readonly namespaceDescription: string;
  readonly description: string;
  readonly inputSchema: TInputSchema;
  readonly outputSchema: TOutputSchema;
  readonly deferLoading?: boolean;
  readonly classifyEffect: (input: z.output<TInputSchema>) => DynamicToolEffect;
  readonly execute: (
    request: DynamicToolExecutionRequest<z.output<TInputSchema>, TContext>,
  ) => Promise<z.input<TOutputSchema>> | z.input<TOutputSchema>;
}

type DynamicToolRegistryErrorCode =
  | "duplicate_registration"
  | "namespace_description_mismatch"
  | "tool_catalog_stale"
  | "tool_not_found"
  | "invalid_arguments"
  | "invalid_output";

export class DynamicToolRegistryError extends Error {
  public constructor(
    public readonly code: DynamicToolRegistryErrorCode,
    message: string,
    public readonly issues: readonly string[] = [],
  ) {
    super(message);
    this.name = "DynamicToolRegistryError";
  }
}

interface ErasedDynamicToolRegistration<TContext> extends DynamicToolExecutionIdentity {
  readonly namespaceDescription: string;
  readonly description: string;
  readonly inputSchema: z.ZodType;
  readonly outputSchema: z.ZodType;
  readonly deferLoading?: boolean;
  readonly classifyEffect: (input: unknown) => DynamicToolEffect;
  readonly execute: (
    request: DynamicToolExecutionRequest<unknown, TContext>,
  ) => Promise<unknown> | unknown;
}

export interface DynamicToolExecutionResult<TOutput = unknown> {
  readonly effect: DynamicToolEffect;
  readonly output: TOutput;
}

function registryKey(identity: DynamicToolExecutionIdentity): string {
  return JSON.stringify([
    identity.namespace,
    identity.toolsetRevision,
    identity.tool,
  ]);
}

function catalogKey(selection: DynamicToolCatalogSelection): string {
  return JSON.stringify([selection.namespace, selection.toolsetRevision]);
}

function formatZodIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "<root>";
    return `${path}: ${issue.message}`;
  });
}

export function toProtocolJsonSchema(
  schema: z.ZodType,
): DynamicToolFunctionSpec["inputSchema"] {
  return z.toJSONSchema(schema) as DynamicToolFunctionSpec["inputSchema"];
}

export class DynamicToolRegistry<TContext> {
  readonly #registrations = new Map<string, ErasedDynamicToolRegistration<TContext>>();
  readonly #catalogs = new Map<string, Set<string>>();
  readonly #namespaceDescriptions = new Map<string, string>();

  public register<
    TInputSchema extends z.ZodType,
    TOutputSchema extends z.ZodType,
  >(
    registration: DynamicToolRegistration<TInputSchema, TOutputSchema, TContext>,
  ): this {
    const key = registryKey(registration);
    if (this.#registrations.has(key)) {
      throw new DynamicToolRegistryError(
        "duplicate_registration",
        `Dynamic tool is already registered: ${registration.namespace}@${registration.toolsetRevision}.${registration.tool}`,
      );
    }

    const namespaceDescriptionKey = catalogKey(registration);
    const knownDescription = this.#namespaceDescriptions.get(namespaceDescriptionKey);
    if (knownDescription !== undefined && knownDescription !== registration.namespaceDescription) {
      throw new DynamicToolRegistryError(
        "namespace_description_mismatch",
        `Dynamic tool namespace description differs within ${registration.namespace}@${registration.toolsetRevision}`,
      );
    }

    const erased: ErasedDynamicToolRegistration<TContext> = {
      ...registration,
      classifyEffect: (input) => registration.classifyEffect(
        input as z.output<TInputSchema>,
      ),
      execute: (request) => registration.execute({
        ...request,
        input: request.input as z.output<TInputSchema>,
      }),
    };
    this.#registrations.set(key, erased);
    this.#namespaceDescriptions.set(
      namespaceDescriptionKey,
      registration.namespaceDescription,
    );
    const catalog = this.#catalogs.get(namespaceDescriptionKey) ?? new Set<string>();
    catalog.add(registration.tool);
    this.#catalogs.set(namespaceDescriptionKey, catalog);
    return this;
  }

  public buildCatalog(selections: readonly DynamicToolCatalogSelection[]): DynamicToolSpec[] {
    const seenNamespaces = new Set<string>();
    return selections.map((selection) => {
      if (seenNamespaces.has(selection.namespace)) {
        throw new DynamicToolRegistryError(
          "tool_catalog_stale",
          `A dynamic-tool catalog cannot select multiple revisions of namespace ${selection.namespace}`,
        );
      }
      seenNamespaces.add(selection.namespace);

      const key = catalogKey(selection);
      const tools = this.#catalogs.get(key);
      const description = this.#namespaceDescriptions.get(key);
      if (!tools || description === undefined) {
        throw new DynamicToolRegistryError(
          "tool_catalog_stale",
          `Unsupported dynamic-tool catalog: ${selection.namespace}@${selection.toolsetRevision}`,
        );
      }

      return {
        type: "namespace",
        name: selection.namespace,
        description,
        tools: [...tools]
          .sort((left, right) => left.localeCompare(right))
          .map((tool) => {
            const registration = this.#registrations.get(registryKey({ ...selection, tool }));
            if (!registration) {
              throw new DynamicToolRegistryError(
                "tool_catalog_stale",
                `Missing dynamic-tool registration: ${selection.namespace}@${selection.toolsetRevision}.${tool}`,
              );
            }
            return {
              type: "function",
              name: registration.tool,
              description: registration.description,
              inputSchema: toProtocolJsonSchema(registration.inputSchema),
              ...(registration.deferLoading === undefined
                ? {}
                : { deferLoading: registration.deferLoading }),
            };
          }),
      } satisfies DynamicToolSpec;
    });
  }

  public async execute(
    identity: DynamicToolExecutionIdentity,
    rawInput: unknown,
    context: TContext,
  ): Promise<DynamicToolExecutionResult> {
    const catalog = this.#catalogs.get(catalogKey(identity));
    if (!catalog) {
      throw new DynamicToolRegistryError(
        "tool_catalog_stale",
        `Unsupported dynamic-tool catalog: ${identity.namespace}@${identity.toolsetRevision}`,
      );
    }

    const registration = this.#registrations.get(registryKey(identity));
    if (!registration) {
      throw new DynamicToolRegistryError(
        "tool_not_found",
        `Dynamic tool is not registered: ${identity.namespace}@${identity.toolsetRevision}.${identity.tool}`,
      );
    }

    const parsedInput = registration.inputSchema.safeParse(rawInput);
    if (!parsedInput.success) {
      throw new DynamicToolRegistryError(
        "invalid_arguments",
        `Invalid arguments for ${identity.namespace}.${identity.tool}`,
        formatZodIssues(parsedInput.error),
      );
    }

    const effect = registration.classifyEffect(parsedInput.data);
    const rawOutput = await registration.execute({
      identity,
      input: parsedInput.data,
      context,
    });
    const parsedOutput = registration.outputSchema.safeParse(rawOutput);
    if (!parsedOutput.success) {
      throw new DynamicToolRegistryError(
        "invalid_output",
        `Invalid output from ${identity.namespace}.${identity.tool}`,
        formatZodIssues(parsedOutput.error),
      );
    }

    return { effect, output: parsedOutput.data };
  }
}
