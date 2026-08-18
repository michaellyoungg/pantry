/**
 * Static checks on `apps/mobile/e2e`, run by `pnpm test`.
 *
 * Executing a flow needs a simulator, a native build and the compose stack, so
 * no PR run does — it happens nightly (BL-0073). That would leave the breaks
 * these files are most prone to — a renamed selector, a moved subflow, a
 * `${VAR}` nobody sets — landing green and surfacing hours later as "the app is
 * broken". These assertions launch nothing; they only ask whether the flows
 * still describe the app in the tree.
 *
 * The export conditions are overridden because this file reads YAML in Node,
 * not on a device: `jest-expo` resolves with React Native's conditions, under
 * which `yaml` hands back its browser build — ESM, which the preset's transform
 * ignores because it lives in `node_modules`.
 *
 * @jest-environment-options {"customExportConditions": ["node", "require", "default"]}
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseAllDocuments } from "yaml";
import { E2E_MANUAL_ITEM, E2E_SELECTOR_IDS } from "./e2eSelectors";

const E2E_ROOT = path.resolve(__dirname, "../../e2e");
const APP_JSON = JSON.parse(readFileSync(path.resolve(__dirname, "../../app.json"), "utf8"));

/** Env vars `scripts/mobile-e2e.sh` passes with `maestro test -e`. */
const RUNNER_ENV = ["E2E_EMAIL", "E2E_PASSWORD", "E2E_EMAIL_2"];

function ymlFiles(dir: string): string[] {
  return readdirSync(path.join(E2E_ROOT, dir))
    .filter((file) => file.endsWith(".yml"))
    .map((file) => `${dir}/${file}`);
}

const FLOWS = ymlFiles("flows");
const SUBFLOWS = ymlFiles("subflows");

function read(relative: string): string {
  return readFileSync(path.join(E2E_ROOT, relative), "utf8");
}

/**
 * A Maestro flow is two YAML documents — header, then command list. Subflows may
 * omit the header, so the split is by count rather than assumed.
 */
function parseFlow(relative: string): { header: Record<string, unknown>; commands: unknown[] } {
  const docs = parseAllDocuments(read(relative)).map((doc) => doc.toJS());
  const commands = docs.at(-1);
  expect(Array.isArray(commands)).toBe(true);
  return {
    header: docs.length > 1 ? (docs[0] as Record<string, unknown>) : {},
    commands: commands as unknown[],
  };
}

/** Every `id:` selector anywhere in a command tree. */
function selectorsIn(node: unknown): string[] {
  if (Array.isArray(node)) return node.flatMap(selectorsIn);
  if (node === null || typeof node !== "object") return [];

  return Object.entries(node).flatMap(([key, value]) =>
    key === "id" && typeof value === "string" ? [value] : selectorsIn(value),
  );
}

/**
 * Every `runFlow` in a command tree, in both spellings Maestro accepts: a bare
 * path, and the object form that also passes variables down.
 */
function runFlowsIn(node: unknown): { file: string; env: Record<string, unknown> }[] {
  if (Array.isArray(node)) return node.flatMap(runFlowsIn);
  if (node === null || typeof node !== "object") return [];

  return Object.entries(node).flatMap(([key, value]) => {
    if (key !== "runFlow") return runFlowsIn(value);
    if (typeof value === "string") return [{ file: value, env: {} }];
    const { file, env } = value as { file?: unknown; env?: unknown };
    return typeof file === "string" ? [{ file, env: (env ?? {}) as Record<string, unknown> }] : [];
  });
}

/** Every `${VAR}` reference in a file, whatever command it sits in. */
function interpolationsIn(source: string): string[] {
  return [...source.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g)].map((match) => match[1]);
}

/** Maestro's `flows:` entries are globs; only `*` is used, and only in a leaf. */
function globToRegExp(glob: string): RegExp {
  return new RegExp(`^${glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*")}$`);
}

const ALL = [...FLOWS, ...SUBFLOWS];

describe("the Maestro workspace", () => {
  it("has flows to check, so nothing below can pass vacuously", () => {
    expect(FLOWS.length).toBeGreaterThan(0);
    expect(SUBFLOWS.length).toBeGreaterThan(0);
  });

  it("runs the flows and not the subflows", () => {
    // A subflow assumes a caller has launched the app and set E2E_EMAIL. Run
    // standalone it fails at its first step, and the report blames the app.
    const patterns = (parseAllDocuments(read("config.yaml"))[0].toJS().flows as string[]).map(
      globToRegExp,
    );

    expect(FLOWS.filter((flow) => !patterns.some((re) => re.test(flow)))).toEqual([]);
    expect(SUBFLOWS.filter((sub) => patterns.some((re) => re.test(sub)))).toEqual([]);
  });

  it("targets the bundle identifier this app actually builds", () => {
    // Change the identifier in app.json and every flow silently addresses an
    // app that is not installed.
    const { ios, android } = APP_JSON.expo;
    expect(ios.bundleIdentifier).toBe(android.package);

    for (const flow of ALL) {
      expect({ flow, appId: parseFlow(flow).header.appId }).toEqual({
        flow,
        appId: ios.bundleIdentifier,
      });
    }
  });

  it("only runs subflows that exist", () => {
    for (const flow of ALL) {
      const dir = path.dirname(path.join(E2E_ROOT, flow));

      for (const { file: target } of runFlowsIn(parseFlow(flow).commands)) {
        expect({ flow, target, exists: existsRelative(dir, target) }).toEqual({
          flow,
          target,
          exists: true,
        });
      }
    }
  });

  it("only passes a subflow variables that subflow reads", () => {
    // The object form of `runFlow` overrides a variable for the callee — how
    // the isolation flow signs up a second account through the same subflow.
    // A key the callee never interpolates is a typo that changes nothing, and
    // the run then does the first account's work twice and asserts isolation
    // between an account and itself.
    for (const flow of ALL) {
      const dir = path.dirname(path.join(E2E_ROOT, flow));

      for (const { file: target, env } of runFlowsIn(parseFlow(flow).commands)) {
        const readsInTarget = new Set(
          interpolationsIn(readFileSync(path.resolve(dir, target), "utf8")),
        );
        for (const name of Object.keys(env)) {
          expect({ flow, target, name, read: readsInTarget.has(name) }).toEqual({
            flow,
            target,
            name,
            read: true,
          });
        }
      }
    }
  });

  it("only interpolates variables the runner actually sets", () => {
    // An unset `${VAR}` is not an error in Maestro — it interpolates to the
    // literal text, so `${E2E_MAIL}` types itself into the email field and the
    // failure is a rejected sign-up.
    for (const flow of ALL) {
      for (const name of interpolationsIn(read(flow))) {
        expect({ flow, name, known: RUNNER_ENV.includes(name) }).toEqual({
          flow,
          name,
          known: true,
        });
      }
    }
  });
});

describe("the flows' selectors", () => {
  const used = new Set(ALL.flatMap((flow) => selectorsIn(parseFlow(flow).commands)));

  it("are all declared in e2eSelectors.ts", () => {
    expect([...used].filter((id) => !E2E_SELECTOR_IDS.includes(id as never))).toEqual([]);
  });

  it("leave no declared selector unused", () => {
    // Otherwise the render assertions next door go on passing for an element no
    // flow can reach.
    expect(E2E_SELECTOR_IDS.filter((id) => !used.has(id))).toEqual([]);
  });

  it("type the item their grocery selectors are keyed to", () => {
    // `list.item.garlic` is only findable because a subflow types the word the
    // key is slugged from. Changing the typed text and nothing else leaves
    // every id here valid and every assertion on the line unmatched, which
    // reads on the report as the grocery screen being broken.
    const typed = parseFlow("subflows/add-manual-item.yml")
      .commands.map((command) =>
        typeof command === "object" && command !== null
          ? (command as { inputText?: unknown }).inputText
          : undefined,
      )
      .filter((value) => typeof value === "string");

    expect(typed).toEqual([E2E_MANUAL_ITEM]);
  });
});

function existsRelative(dir: string, target: string): boolean {
  try {
    readFileSync(path.resolve(dir, target));
    return true;
  } catch {
    return false;
  }
}
