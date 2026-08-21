import { describe, expect, test } from "vite-plus/test";
import { z } from "zod";
import { DynamicToolRegistry, DynamicToolRegistryError } from "./dynamic-tool-registry";

interface TestContext {
  readonly trace: string[];
}

function registerEcho(
  registry: DynamicToolRegistry<TestContext>,
  namespace: string,
  toolsetRevision: number,
  marker: string,
): void {
  registry.register({
    namespace,
    namespaceDescription: `${namespace} tools`,
    toolsetRevision,
    tool: "echo",
    description: `Echo through ${namespace}`,
    inputSchema: z.strictObject({ value: z.string().min(1) }),
    outputSchema: z.strictObject({ echoed: z.string() }),
    deferLoading: false,
    classifyEffect: () => "read",
    execute: ({ input, context }) => {
      context.trace.push(marker);
      return { echoed: `${marker}:${input.value}` };
    },
  });
}

describe("DynamicToolRegistry", () => {
  test("dispatches the same tool name independently by namespace and revision", async () => {
    const registry = new DynamicToolRegistry<TestContext>();
    registerEcho(registry, "codex_app", 1, "codex");
    registerEcho(registry, "nodex_app", 1, "nodex-v1");
    registerEcho(registry, "nodex_app", 2, "nodex-v2");
    const context: TestContext = { trace: [] };

    const codex = await registry.execute(
      {
        namespace: "codex_app",
        toolsetRevision: 1,
        tool: "echo",
      },
      { value: "one" },
      context,
    );
    const nodex = await registry.execute(
      {
        namespace: "nodex_app",
        toolsetRevision: 2,
        tool: "echo",
      },
      { value: "two" },
      context,
    );

    expect(codex).toEqual({ effect: "read", output: { echoed: "codex:one" } });
    expect(nodex).toEqual({ effect: "read", output: { echoed: "nodex-v2:two" } });
    expect(context.trace).toEqual(["codex", "nodex-v2"]);
  });

  test("generates strict app-server JSON Schema from the registered Zod schema", () => {
    const registry = new DynamicToolRegistry<TestContext>();
    registerEcho(registry, "nodex_app", 1, "nodex");

    const catalog = registry.buildCatalog([
      {
        namespace: "nodex_app",
        toolsetRevision: 1,
      },
    ]);
    const namespace = catalog[0];
    expect(namespace?.type).toBe("namespace");
    if (!namespace || namespace.type !== "namespace") return;
    const schema = namespace.tools[0]?.inputSchema as Record<string, unknown>;

    expect(namespace.name).toBe("nodex_app");
    expect(namespace.tools[0]?.name).toBe("echo");
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(["value"]);
  });

  test("rejects unknown keys before execution", async () => {
    const registry = new DynamicToolRegistry<TestContext>();
    registerEcho(registry, "nodex_app", 1, "nodex");
    const context: TestContext = { trace: [] };

    await expect(
      registry.execute(
        {
          namespace: "nodex_app",
          toolsetRevision: 1,
          tool: "echo",
        },
        { value: "hello", projectId: "forged" },
        context,
      ),
    ).rejects.toMatchObject({
      code: "invalid_arguments",
    });
    expect(context.trace).toEqual([]);
  });

  test("distinguishes stale catalogs from unknown tools", async () => {
    const registry = new DynamicToolRegistry<TestContext>();
    registerEcho(registry, "nodex_app", 1, "nodex");
    const context: TestContext = { trace: [] };

    await expect(
      registry.execute(
        {
          namespace: "nodex_app",
          toolsetRevision: 99,
          tool: "echo",
        },
        { value: "hello" },
        context,
      ),
    ).rejects.toMatchObject({
      code: "tool_catalog_stale",
    });
    await expect(
      registry.execute(
        {
          namespace: "nodex_app",
          toolsetRevision: 1,
          tool: "missing",
        },
        { value: "hello" },
        context,
      ),
    ).rejects.toMatchObject({
      code: "tool_not_found",
    });
  });

  test("rejects duplicate registrations and invalid executor output", async () => {
    const registry = new DynamicToolRegistry<TestContext>();
    registerEcho(registry, "nodex_app", 1, "nodex");
    expect(() => registerEcho(registry, "nodex_app", 1, "duplicate")).toThrow(
      DynamicToolRegistryError,
    );

    registry.register({
      namespace: "nodex_app",
      namespaceDescription: "nodex_app tools",
      toolsetRevision: 1,
      tool: "broken",
      description: "Returns the wrong output for the test",
      inputSchema: z.strictObject({}),
      outputSchema: z.strictObject({ ok: z.literal(true) }),
      classifyEffect: () => "write",
      execute: () => ({ ok: false }) as unknown as { ok: true },
    });

    await expect(
      registry.execute(
        {
          namespace: "nodex_app",
          toolsetRevision: 1,
          tool: "broken",
        },
        {},
        { trace: [] },
      ),
    ).rejects.toMatchObject({ code: "invalid_output" });
  });
});
