/**
 * Static checks on `apps/mobile/e2e`, run by `pnpm test`.
 *
 * Executing a flow needs a simulator, a native build and the compose stack, so
 * no PR run does (BL-0073). That would leave the breaks these files are most
 * prone to — a renamed selector, a moved subflow, a `${VAR}` nobody sets —
 * landing green and surfacing hours later as "the app is broken". These
 * assertions launch nothing; they only ask whether the flows still describe the
 * app in the tree.
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
import { E2E_SELECTOR_IDS } from "./e2eSelectors";

const E2E_ROOT = path.resolve(__dirname, "../../e2e");
const APP_JSON = JSON.parse(readFileSync(path.resolve(__dirname, "../../app.json"), "utf8"));

/** Env vars `scripts/mobile-e2e.sh` passes with `maestro test -e`. */
const RUNNER_ENV = ["E2E_EMAIL", "E2E_PASSWORD"];

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
      const referenced = [...read(flow).matchAll(/runFlow:\s*(\S+)/g)].map((match) => match[1]);

      for (const target of referenced) {
        expect({ flow, target, exists: existsRelative(dir, target) }).toEqual({
          flow,
          target,
          exists: true,
        });
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
});

function existsRelative(dir: string, target: string): boolean {
  try {
    readFileSync(path.resolve(dir, target));
    return true;
  } catch {
    return false;
  }
}
