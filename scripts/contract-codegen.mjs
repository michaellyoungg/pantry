#!/usr/bin/env node
/**
 * Renders the two checked-in artifacts of the recipe-service HTTP contract from
 * `contract/openapi.yaml`:
 *
 *   - packages/types/src/contract.generated.ts — the TypeScript wire types.
 *   - apps/recipe-service/internal/contract/spec_gen_test.go — the table the Go
 *     conformance test reflects the hand-written server structs against.
 *
 *   node scripts/contract-codegen.mjs           # write both
 *   node scripts/contract-codegen.mjs --check   # verify, exit 1 on drift (CI)
 *
 * The outputs are committed so neither `tsc` nor `go build` needs a codegen
 * step, and `--check` is what stops that convenience from turning into a stale
 * contract: it re-renders and compares, exactly like `pnpm backlog:index:check`.
 *
 * Only the subset of OpenAPI documented in contract/README.md is understood.
 * Anything else throws rather than being skipped — a generator that silently
 * drops a field is worse than no generator, because the drift it hides is the
 * drift it was written to catch.
 *
 * `generate` is exported so that subset has tests of its own; see
 * packages/types/src/contractCodegen.test.ts.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const root = new URL("../", import.meta.url);
const SPEC = fileURLToPath(new URL("contract/openapi.yaml", root));
const TS_OUT = fileURLToPath(new URL("packages/types/src/contract.generated.ts", root));
const GO_OUT = fileURLToPath(
  new URL("apps/recipe-service/internal/contract/spec_gen_test.go", root),
);

/** Where an `x-go-types` entry's package lives, and which packages may appear. */
const GO_MODULE = "pantry/apps/recipe-service/internal";
const GO_PACKAGES = ["nutrition", "pricing", "recipe", "recommend"];

const HTTP_METHODS = ["get", "put", "post", "delete", "patch", "head", "options"];

/**
 * Renders both artifacts from a parsed OpenAPI document.
 *
 * Everything is nested here so the schema map is a closure rather than module
 * state, which is what lets a test render a three-schema document without
 * touching the real spec.
 */
export function generate(spec) {
  const schemas = spec.components?.schemas ?? {};
  checkRefs(spec);

  // ── Spec navigation ─────────────────────────────────────────────────────

  /** Resolves `#/components/schemas/X`, failing loudly on a typo. */
  function refName(ref) {
    const prefix = "#/components/schemas/";
    if (!ref.startsWith(prefix)) throw new Error(`unsupported $ref: ${ref}`);
    const name = ref.slice(prefix.length);
    if (!(name in schemas)) throw new Error(`$ref names an undefined schema: ${name}`);
    return name;
  }

  /** The `type:` keyword, normalized to `{ types, nullable }`. */
  function typeOf(schema) {
    const raw = schema.type;
    if (raw === undefined) return { types: [], nullable: false };
    const list = Array.isArray(raw) ? raw : [raw];
    return { types: list.filter((t) => t !== "null"), nullable: list.includes("null") };
  }

  /** Splits a `oneOf` into its non-null members plus whether null was one. */
  function oneOfMembers(schema) {
    const members = [];
    let nullable = false;
    for (const member of schema.oneOf) {
      if (member.type === "null") nullable = true;
      else members.push(member);
    }
    return { members, nullable };
  }

  function isNullable(schema) {
    return schema.oneOf ? oneOfMembers(schema).nullable : typeOf(schema).nullable;
  }

  // ── TypeScript ──────────────────────────────────────────────────────────

  /** Renders one schema as a TypeScript type expression. */
  function tsType(schema, name) {
    if (schema.$ref) return refName(schema.$ref);
    if (schema.oneOf) {
      const { members, nullable } = oneOfMembers(schema);
      const parts = members.map((member) => tsType(member, name));
      if (nullable) parts.push("null");
      return parts.join(" | ");
    }
    if (schema.allOf) return schema.allOf.map((member) => tsType(member, name)).join(" & ");

    const { types, nullable } = typeOf(schema);
    if (types.length !== 1) throw new Error(`${name}: expected exactly one non-null type`);
    const nullish = (rendered) => (nullable ? `${rendered} | null` : rendered);

    switch (types[0]) {
      case "string":
        return nullish(
          schema.enum ? schema.enum.map((value) => JSON.stringify(value)).join(" | ") : "string",
        );
      case "integer":
      case "number":
        return nullish("number");
      case "boolean":
        return nullish("boolean");
      case "array":
        if (!schema.items) throw new Error(`${name}: array without items`);
        return nullish(`${parenthesize(tsType(schema.items, name))}[]`);
      case "object":
        if (schema.additionalProperties)
          return nullish(`Record<string, ${tsType(schema.additionalProperties, name)}>`);
        if (schema.properties) throw new Error(`${name}: inline object properties are unsupported`);
        return nullish("Record<string, unknown>");
      default:
        throw new Error(`${name}: unsupported type ${types[0]}`);
    }
  }

  /** Renders a description as a JSDoc block at the given indent. */
  function tsDoc(description, indent) {
    if (!description) return null;
    const lines = description.replace(/\s+$/, "").split("\n");
    if (lines.length === 1 && `${indent} * ${lines[0]}`.length <= 98)
      return `${indent}/** ${lines[0]} */`;
    const body = lines.map((line) => (line ? `${indent} * ${line}` : `${indent} *`)).join("\n");
    return `${indent}/**\n${body}\n${indent} */`;
  }

  function renderTs() {
    const out = [
      "// Code generated by scripts/contract-codegen.mjs from contract/openapi.yaml.",
      "// DO NOT EDIT — run `pnpm contract:codegen` instead.",
      "",
      "/**",
      " * The recipe-service HTTP contract, as TypeScript.",
      " *",
      " * Re-exported by `@pantry/types`; import from there, not from this file.",
      " */",
      "",
    ];

    for (const [name, schema] of Object.entries(schemas)) {
      push(out, tsDoc(schema.description, ""));
      if (!(schema.type === "object" && schema.properties)) {
        out.push(declare(`export type ${name} = `, tsType(schema, name), ""), "");
        continue;
      }

      const required = new Set(schema.required ?? []);
      out.push(`export interface ${name} {`);
      for (const [prop, propSchema] of Object.entries(schema.properties)) {
        push(out, tsDoc(propSchema.description, "  "));
        const optional = required.has(prop) ? "" : "?";
        out.push(declare(`  ${prop}${optional}: `, tsType(propSchema, `${name}.${prop}`), "  "));
      }
      out.push("}", "");
    }

    return `${out
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/\n*$/, "")}\n`;
  }

  // ── Go binding table ────────────────────────────────────────────────────

  /** The JSON-shape "kind" a schema reduces to, in the Go checker's vocabulary. */
  function goKind(schema, name) {
    if (schema.$ref) return goKind(schemas[refName(schema.$ref)], name);
    if (schema.allOf) return "object";
    if (schema.oneOf) {
      const kinds = new Set(oneOfMembers(schema).members.map((member) => goKind(member, name)));
      if (kinds.size !== 1) throw new Error(`${name}: oneOf members must share one kind`);
      return [...kinds][0];
    }
    const { types } = typeOf(schema);
    if (types.length !== 1) throw new Error(`${name}: expected exactly one non-null type`);
    if (types[0] === "array" || types[0] === "object" || types[0] === "boolean") return types[0];
    if (types[0] === "string" || types[0] === "integer" || types[0] === "number") return types[0];
    throw new Error(`${name}: unsupported type ${types[0]}`);
  }

  /**
   * Flattens a schema into the JSON fields it puts on the wire, resolving
   * `allOf` the way Go flattens an embedded struct.
   */
  function fieldsOf(name, schema, seen = new Set()) {
    if (schema.$ref) {
      const target = refName(schema.$ref);
      return fieldsOf(target, schemas[target], seen);
    }
    if (schema.allOf) return schema.allOf.flatMap((member) => fieldsOf(name, member, seen));
    if (!schema.properties) throw new Error(`${name}: bound schema has no properties`);

    const required = new Set(schema.required ?? []);
    return Object.entries(schema.properties).map(([prop, propSchema]) => {
      if (seen.has(prop)) throw new Error(`${name}: duplicate field ${prop}`);
      seen.add(prop);
      return {
        name: prop,
        kind: goKind(propSchema, `${name}.${prop}`),
        required: required.has(prop),
        nullable: isNullable(propSchema),
      };
    });
  }

  /** Every `METHOD /path` pattern the spec describes, in the order Go sorts them. */
  function routes() {
    const found = [];
    for (const [path, item] of Object.entries(spec.paths ?? {})) {
      for (const method of Object.keys(item)) {
        if (HTTP_METHODS.includes(method)) found.push(`${method.toUpperCase()} ${path}`);
      }
    }
    return found.sort(byteOrder);
  }

  function renderGo() {
    const bindings = [];
    const packages = new Set();

    for (const [name, schema] of Object.entries(schemas)) {
      const types = schema["x-go-types"];
      if (!types) {
        if (!schema["x-go-unbound"])
          throw new Error(`${name}: needs x-go-types or x-go-unbound (with the reason)`);
        continue;
      }
      // A `request` schema is decoded, never encoded, so a Go struct tag says
      // nothing about what a client must send — only names and kinds are checked.
      const strict = (schema["x-go-direction"] ?? "response") === "response";
      const fields = fieldsOf(name, schema);
      for (const goType of types) {
        const pkg = goType.split(".")[0];
        if (!GO_PACKAGES.includes(pkg)) throw new Error(`${name}: unknown Go package ${pkg}`);
        packages.add(pkg);
        bindings.push({ schema: name, goType, strict, fields });
      }
    }

    const out = [
      "// Code generated by scripts/contract-codegen.mjs from contract/openapi.yaml.",
      "// DO NOT EDIT — run `pnpm contract:codegen` instead.",
      "",
      "package contract",
      "",
      "import (",
      '\t"reflect"',
      "",
      ...[...packages].sort(byteOrder).map((pkg) => `\t"${GO_MODULE}/${pkg}"`),
      ")",
      "",
      "// specRoutes is every method+path pattern contract/openapi.yaml describes,",
      "// sorted, so TestRoutesMatchSpec can compare it to the registered router.",
      "var specRoutes = []string{",
      ...routes().map((route) => `\t${JSON.stringify(route)},`),
      "}",
      "",
      "// specBindings pairs each schema the spec binds to a Go type with the JSON",
      "// shape that schema promises. TestStructsMatchSpec reflects the Go type and",
      "// reports every difference.",
      "var specBindings = []binding{",
    ];

    for (const binding of bindings) {
      out.push(
        `\tbind(${JSON.stringify(binding.schema)}, reflect.TypeOf(${binding.goType}{}), ${binding.strict},`,
      );
      for (const f of binding.fields) {
        out.push(
          `\t\tfield{${JSON.stringify(f.name)}, ${JSON.stringify(f.kind)}, ${f.required}, ${f.nullable}},`,
        );
      }
      out.push("\t),");
    }

    out.push("}", "");
    return out.join("\n");
  }

  return { ts: renderTs(), go: renderGo() };
}

/**
 * Resolves every `$ref` in the whole document, `paths` included.
 *
 * The renderers only ever walk `components.schemas`, so a typo in a response or
 * parameter reference would produce no output and no error — the spec would
 * quietly describe an endpoint nobody can read. This walks the document instead
 * of the part being rendered, for that reason.
 */
function checkRefs(spec) {
  const walk = (node, path) => {
    if (node === null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach((item, i) => walk(item, `${path}/${i}`));
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === "$ref") {
        if (typeof value !== "string" || !value.startsWith("#/"))
          throw new Error(`${path}: only local $refs are supported, got ${String(value)}`);
        let target = spec;
        for (const segment of value.slice(2).split("/")) {
          target = target?.[segment];
          if (target === undefined) throw new Error(`${path}: $ref does not resolve: ${value}`);
        }
      } else {
        walk(value, `${path}/${key}`);
      }
    }
  };
  walk(spec, "#");
}

/**
 * Orders strings the way Go's `slices.Sort` does. The route list is compared to
 * `recipe.RoutePatterns()`, so the two sorts have to agree; locale-aware
 * comparison would not.
 */
function byteOrder(a, b) {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

/** Appends a line only when there is one, so absent JSDoc leaves no blank. */
function push(out, line) {
  if (line !== null) out.push(line);
}

/** Parenthesizes a union so `A | B` arrays render as `(A | B)[]`. */
function parenthesize(rendered) {
  return rendered.includes(" | ") ? `(${rendered})` : rendered;
}

/**
 * Emits `<prefix><type>;`, breaking a union across lines when it would run past
 * the 100 columns oxfmt formats to.
 */
function declare(prefix, rendered, indent) {
  const line = `${prefix}${rendered};`;
  if (line.length <= 100 || !rendered.includes(" | ")) return line;
  const parts = rendered.split(" | ");
  return `${prefix.trimEnd()}\n${parts.map((part) => `${indent}  | ${part}`).join("\n")};`;
}

// ── CLI ───────────────────────────────────────────────────────────────────

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const rendered = generate(parse(readFileSync(SPEC, "utf8")));
  const outputs = [
    { path: TS_OUT, contents: rendered.ts },
    { path: GO_OUT, contents: rendered.go },
  ];

  if (process.argv.includes("--check")) {
    const stale = outputs.filter((out) => read(out.path) !== out.contents);
    if (stale.length > 0) {
      console.error(
        `contract: ${stale.length} generated file(s) are out of date with contract/openapi.yaml:\n` +
          stale.map((out) => `  - ${out.path}`).join("\n") +
          "\nRun `pnpm contract:codegen` and commit the result.",
      );
      process.exit(1);
    }
    console.log(`contract: ${outputs.length} generated files are up to date`);
  } else {
    for (const out of outputs) {
      writeFileSync(out.path, out.contents, "utf8");
      console.log(`contract → ${out.path}`);
    }
  }
}

/** Reads a generated file, treating "missing" as "empty" so --check fails on it. */
function read(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}
