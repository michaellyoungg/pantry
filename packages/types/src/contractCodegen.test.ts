/**
 * Tests the subset of OpenAPI `scripts/contract-codegen.mjs` understands.
 *
 * Most of this package is rendered by that script, and the Go conformance table
 * it also renders is what pins the server structs to the same spec. A quiet bug
 * in the renderer therefore weakens both halves of the contract at once — and
 * `--check` would not notice, because it compares the generator against itself.
 *
 * These cases are the ones the real spec depends on: optionality, nullability,
 * `allOf` flattening, open maps, and the two rules that make the Go binding
 * table meaningful.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
// @ts-expect-error — a repo-root .mjs script with no type declarations.
import { generate } from "../../../scripts/contract-codegen.mjs";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

/** Wraps schemas in the minimum document `generate` needs. */
function render(schemas: Record<string, unknown>, paths: Record<string, unknown> = {}) {
  return generate({ paths, components: { schemas } }) as { ts: string; go: string };
}

/** The default a schema needs to opt out of the Go binding check. */
const unbound = { "x-go-unbound": "test fixture" };

describe("TypeScript rendering", () => {
  it("marks anything outside `required` as optional", () => {
    const { ts } = render({
      Thing: {
        type: "object",
        ...unbound,
        required: ["always"],
        properties: { always: { type: "string" }, sometimes: { type: "integer" } },
      },
    });

    expect(ts).toContain("always: string;");
    expect(ts).toContain("sometimes?: number;");
  });

  it("renders a nullable type as a union rather than an optional", () => {
    const { ts } = render({
      Thing: {
        type: "object",
        ...unbound,
        required: ["grams"],
        properties: { grams: { type: ["number", "null"] } },
      },
    });

    // The distinction is the point: the server always sends the key, and its
    // value can be null. An optional would let a caller forget to handle null.
    expect(ts).toContain("grams: number | null;");
  });

  it("renders enums, arrays, refs and open maps", () => {
    const { ts } = render({
      Kind: { type: "string", enum: ["a", "b"], ...unbound },
      Thing: {
        type: "object",
        ...unbound,
        required: ["kinds", "one", "amounts"],
        properties: {
          kinds: { type: "array", items: { $ref: "#/components/schemas/Kind" } },
          one: { $ref: "#/components/schemas/Kind" },
          amounts: { type: "object", additionalProperties: { type: "number" } },
        },
      },
    });

    expect(ts).toContain('export type Kind = "a" | "b";');
    expect(ts).toContain("kinds: Kind[];");
    expect(ts).toContain("one: Kind;");
    expect(ts).toContain("amounts: Record<string, number>;");
  });

  it("parenthesizes a union inside an array so the element type is not the union", () => {
    const { ts } = render({
      Thing: {
        type: "object",
        ...unbound,
        required: ["values"],
        properties: { values: { type: "array", items: { type: ["string", "null"] } } },
      },
    });

    expect(ts).toContain("values: (string | null)[];");
  });

  it("renders allOf as an intersection", () => {
    const { ts } = render({
      A: { type: "object", ...unbound, required: ["a"], properties: { a: { type: "string" } } },
      B: { type: "object", ...unbound, required: ["b"], properties: { b: { type: "string" } } },
      Both: {
        allOf: [{ $ref: "#/components/schemas/A" }, { $ref: "#/components/schemas/B" }],
        ...unbound,
      },
    });

    expect(ts).toContain("export type Both = A & B;");
  });

  it("turns descriptions into JSDoc, because the spec is where the rationale lives", () => {
    const { ts } = render({
      Thing: {
        type: "object",
        description: "Why this exists.",
        ...unbound,
        required: ["id"],
        properties: { id: { type: "string", description: "Why this field exists." } },
      },
    });

    expect(ts).toContain("/** Why this exists. */");
    expect(ts).toContain("  /** Why this field exists. */");
  });
});

describe("Go binding table", () => {
  it("emits one binding per Go type, so two structs can be pinned to one schema", () => {
    const { go } = render({
      Coverage: {
        type: "object",
        "x-go-types": ["nutrition.Coverage", "recommend.NutritionCoverage"],
        required: ["totalCount"],
        properties: { totalCount: { type: "integer" } },
      },
    });

    expect(go).toContain('bind("Coverage", reflect.TypeOf(nutrition.Coverage{}), true,');
    expect(go).toContain('bind("Coverage", reflect.TypeOf(recommend.NutritionCoverage{}), true,');
    expect(go).toContain('field{"totalCount", "integer", true, false},');
  });

  it("relaxes a request schema, whose Go tags say nothing about what a client sends", () => {
    const { go } = render({
      Ask: {
        type: "object",
        "x-go-types": ["recommend.UserContext"],
        "x-go-direction": "request",
        required: [],
        properties: { limit: { type: "integer" } },
      },
    });

    expect(go).toContain('bind("Ask", reflect.TypeOf(recommend.UserContext{}), false,');
  });

  it("flattens allOf, the way Go flattens an embedded struct", () => {
    const { go } = render({
      A: { type: "object", ...unbound, required: ["a"], properties: { a: { type: "string" } } },
      B: { type: "object", ...unbound, required: ["b"], properties: { b: { type: "boolean" } } },
      Both: {
        allOf: [{ $ref: "#/components/schemas/A" }, { $ref: "#/components/schemas/B" }],
        "x-go-types": ["recipe.EquipmentMatch"],
      },
    });

    expect(go).toContain('field{"a", "string", true, false},');
    expect(go).toContain('field{"b", "boolean", true, false},');
  });

  it("lists the routes the spec describes, sorted", () => {
    const { go } = render({}, { "/b": { post: {} }, "/a": { get: {}, delete: {} } });

    expect(go).toContain('\t"DELETE /a",\n\t"GET /a",\n\t"POST /b",\n');
  });
});

describe("refusals", () => {
  it("refuses a schema that declares neither a Go type nor a reason for having none", () => {
    expect(() => render({ Thing: { type: "object", properties: {} } })).toThrow(/x-go-unbound/);
  });

  it("refuses a $ref to a schema that does not exist", () => {
    expect(() =>
      render({
        Thing: {
          type: "object",
          ...unbound,
          required: ["gone"],
          properties: { gone: { $ref: "#/components/schemas/Missing" } },
        },
      }),
    ).toThrow(/Missing/);
  });

  it("refuses a dangling $ref anywhere in the document, not just in a schema", () => {
    // A response reference is never rendered, so nothing else would notice.
    expect(() =>
      render(
        {},
        { "/thing": { get: { responses: { "200": { $ref: "#/components/responses/Nope" } } } } },
      ),
    ).toThrow(/does not resolve/);
  });

  it("refuses a $ref to another document", () => {
    expect(() =>
      render({}, { "/thing": { get: { responses: { "200": { $ref: "other.yaml#/Thing" } } } } }),
    ).toThrow(/only local \$refs/);
  });

  it("refuses a Go package outside the recipe-service internals", () => {
    expect(() =>
      render({
        Thing: {
          type: "object",
          "x-go-types": ["elsewhere.Thing"],
          required: [],
          properties: {},
        },
      }),
    ).toThrow(/elsewhere/);
  });
});

describe("the committed output", () => {
  it("is what the current spec renders", () => {
    const spec = parse(readFileSync(`${repoRoot}contract/openapi.yaml`, "utf8"));
    const rendered = generate(spec) as { ts: string; go: string };

    // `pnpm contract:check` is the CI gate; this is the same assertion, so a
    // stale file fails the unit suite too rather than only the lint-ish step.
    expect(readFileSync(`${repoRoot}packages/types/src/contract.generated.ts`, "utf8")).toBe(
      rendered.ts,
    );
    expect(
      readFileSync(`${repoRoot}apps/recipe-service/internal/contract/spec_gen_test.go`, "utf8"),
    ).toBe(rendered.go);
  });
});
