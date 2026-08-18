# The recipe-service HTTP contract

`openapi.yaml` is the single source of truth for every shape that crosses the
Convex ⇄ recipe-service boundary. Before BL-0007 that contract was written twice
— TypeScript types in `packages/types`, mirrored Go structs in
`apps/recipe-service` — with nothing to stop the two from diverging until a
serialization mismatch surfaced at runtime.

```bash
pnpm contract:codegen   # rewrite the generated files
pnpm contract:check     # what CI runs — fails if they are stale
```

## What is generated, and what is checked

| Side | Artifact | How it is pinned |
| --- | --- | --- |
| TypeScript | `packages/types/src/contract.generated.ts` | **Generated.** `@pantry/types` re-exports it; `pnpm contract:check` fails when it is stale. |
| Go | `apps/recipe-service/internal/contract/spec_gen_test.go` | **Checked.** The generated file is a table; `TestStructsMatchSpec` reflects each server struct against it. |
| Routes | the `paths` block | **Checked.** `TestRoutesMatchSpec` compares it to `recipe.RoutePatterns()`. |

The asymmetry is deliberate. Generating the Go types would mean one package that
every wire struct aliases — and the wire structs live in four packages that are
kept apart on purpose. `internal/recommend` imports *nothing*, which is what
makes the ranker a pure, table-testable unit; `internal/nutrition` and
`internal/pricing` likewise refuse a dependency on `internal/recipe`. Collapsing
them onto a shared generated package would delete exactly the boundaries those
packages document at length. The structs also carry things a schema cannot:
pointer fields whose nil-ness is load-bearing (BL-0035's `servings`), methods,
and comments recording why a field is shaped the way it is.

So the spec **generates the client and audits the server**. Drift in either
direction is a build failure rather than a runtime surprise, which is the whole
point of the item.

What the audit can and cannot see: it compares JSON field names, a coarse kind
(`string`, `number`, `integer`, `boolean`, `array`, `object`), presence, and
nullability. It does not compare array element types or map value types — a
schema and a Go struct agree on "array", and pretending to check more than that
would be a check that lies. In practice it catches every drift this contract has
actually suffered: a renamed field, a field one side forgot, a number that became
a string, and an optional that became required.

## Adding or changing an endpoint

1. Edit `openapi.yaml`.
2. Run `pnpm contract:codegen` and commit both generated files.
3. If the change touches a bound schema, `go test ./internal/contract/...` tells
   you which struct no longer matches.

Every schema must declare one of:

- `x-go-types: [pkg.Type, ...]` — the Go type(s) that serve it. More than one is
  legitimate: `NutritionCoverage` is both `nutrition.Coverage` and
  `recommend.NutritionCoverage`, and pinning both is how they stay identical.
- `x-go-unbound: <reason>` — for a shape the server decodes into an anonymous
  struct or writes as a map literal. The reason is required so "no Go type"
  stays a decision rather than an oversight; the generator errors when neither
  key is present.

`x-go-direction: request` relaxes the optionality check for a schema the server
only ever *decodes*. A Go struct tag says nothing about what a client must send
— `omitempty` is an encoding hint and an absent field decodes to the zero value
— so for those, names and kinds are checked and presence is not.

## The subset

The generator understands a deliberately small slice of OpenAPI 3.1, and throws
on anything else rather than skipping it silently:

- `type: object` with `properties` / `required`, and `additionalProperties` for
  an open map (`Record<string, T>`).
- `type: string` with `enum` → a TypeScript union.
- `type: array` with `items`; `integer` and `number` both → `number`.
- `$ref` to `#/components/schemas/...`, including alongside a sibling
  `description`.
- `allOf` → a TypeScript intersection, and a flattened field list on the Go side
  (which is how `EquipmentMatch` mirrors a struct that embeds `Recipe`).
- `oneOf` → a union; a `type: "null"` member makes the field nullable, as does
  `type: [number, "null"]`.
- `description` → the JSDoc on the generated type. The design rationale lives
  here now, so write it in the spec rather than in the generated output.
