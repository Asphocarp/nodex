import { describe, expect, it } from "vitest";
import { extractJsonSchemaRoot, stableJson, type JsonObject } from "./codex-schemas";

describe("Codex runtime schema extraction", () => {
  it("extracts and rewrites a transitive cyclic reference closure", () => {
    const bundle: JsonObject = {
      $schema: "http://json-schema.org/draft-07/schema#",
      definitions: {
        Root: {
          properties: {
            value: { $ref: "#/definitions/v2/Value" },
          },
          type: "object",
        },
        v2: {
          Value: {
            anyOf: [{ type: "string" }, { $ref: "#/definitions/v2/Wrapper" }],
          },
          Wrapper: {
            properties: {
              value: { $ref: "#/definitions/v2/Value" },
            },
            type: "object",
          },
        },
      },
    };

    expect(extractJsonSchemaRoot(bundle, "Root")).toEqual({
      $schema: "http://json-schema.org/draft-07/schema#",
      definitions: {
        definitions__v2__Value: {
          anyOf: [{ type: "string" }, { $ref: "#/definitions/definitions__v2__Wrapper" }],
        },
        definitions__v2__Wrapper: {
          properties: {
            value: { $ref: "#/definitions/definitions__v2__Value" },
          },
          type: "object",
        },
      },
      properties: {
        value: { $ref: "#/definitions/definitions__v2__Value" },
      },
      title: "Root",
      type: "object",
    });
  });

  it("resolves escaped JSON Pointer segments", () => {
    const bundle: JsonObject = {
      $schema: "http://json-schema.org/draft-07/schema#",
      definitions: {
        Root: { $ref: "#/definitions/path~1with~0tokens" },
        "path/with~tokens": { type: "boolean" },
      },
    };

    expect(extractJsonSchemaRoot(bundle, "Root")).toMatchObject({
      $ref: "#/definitions/definitions__path%2Fwith~0tokens",
      definitions: {
        "definitions__path%2Fwith~tokens": { type: "boolean" },
      },
    });
  });

  it("rejects missing roots, unresolved refs, and remote refs", () => {
    const base: JsonObject = {
      $schema: "http://json-schema.org/draft-07/schema#",
      definitions: {},
    };

    expect(() => extractJsonSchemaRoot(base, "Missing")).toThrow("does not define Missing");
    expect(() =>
      extractJsonSchemaRoot(
        {
          ...base,
          definitions: { Root: { $ref: "#/definitions/Missing" } },
        },
        "Root",
      ),
    ).toThrow("unresolved reference");
    expect(() =>
      extractJsonSchemaRoot(
        {
          ...base,
          definitions: { Root: { $ref: "https://example.com/schema.json" } },
        },
        "Root",
      ),
    ).toThrow("unsupported non-local reference");
  });

  it("serializes object keys deterministically without reordering arrays", () => {
    expect(stableJson({ z: 1, a: { y: 2, b: 3 }, order: ["z", "a"] })).toBe(
      '{\n  "a": {\n    "b": 3,\n    "y": 2\n  },\n  "order": [\n    "z",\n    "a"\n  ],\n  "z": 1\n}\n',
    );
  });
});
