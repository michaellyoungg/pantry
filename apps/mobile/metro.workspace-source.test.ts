/**
 * Guards the single most fragile piece of this app's configuration.
 *
 * These assertions are about *paths*, not behaviour, which is unusual for a
 * test — but the failure they prevent is a stale `dist/` being bundled into the
 * simulator, and that failure is invisible to every other check in the repo:
 * `tsc` reads the same stale `.d.ts` and stays green.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { createWorkspaceSourceResolver, WORKSPACE_SOURCE_DIRS } from "./metro.workspace-source";

const workspaceRoot = path.resolve(__dirname, "../..");
const resolve = createWorkspaceSourceResolver(workspaceRoot);
/** A file standing in for "some module inside apps/mobile". */
const fromApp = path.join(__dirname, "app", "_layout.tsx");

const relativeToRoot = (absolute: string) => path.relative(workspaceRoot, absolute);

describe("workspace package specifiers", () => {
  it("resolves a package root to its source entry, not dist", () => {
    const resolved = resolve(fromApp, "@pantry/design-tokens");

    expect(resolved).not.toBeNull();
    expect(relativeToRoot(resolved as string)).toBe(
      path.join("packages", "design-tokens", "src", "index.ts"),
    );
  });

  it("resolves a subpath export to source", () => {
    const resolved = resolve(fromApp, "@pantry/core/react");

    expect(relativeToRoot(resolved as string)).toBe(
      path.join("packages", "core", "src", "react", "index.ts"),
    );
  });

  it("resolves the @pantry/core/data screen hooks to source", () => {
    // BL-0055's entry point: what real screens call, and the one most likely to
    // be edited and re-run in the same minute.
    const resolved = resolve(fromApp, "@pantry/core/data");

    expect(relativeToRoot(resolved as string)).toBe(
      path.join("packages", "core", "src", "data", "index.ts"),
    );
  });

  it("never resolves a workspace package into dist", () => {
    for (const pkg of Object.keys(WORKSPACE_SOURCE_DIRS)) {
      const resolved = resolve(fromApp, pkg);
      expect(resolved).not.toBeNull();
      expect(resolved).not.toContain(`${path.sep}dist${path.sep}`);
    }
  });

  it("covers every dist-shipping @pantry dependency of this app", () => {
    // The omission this catches is silent: a package left out of the map keeps
    // working via `dist/`, right up until `dist/` is stale.
    const pkg = require("./package.json") as { dependencies: Record<string, string> };
    const workspaceDeps = Object.keys(pkg.dependencies).filter((name) =>
      name.startsWith("@pantry/"),
    );

    for (const name of workspaceDeps) {
      const manifest = path.join(
        workspaceRoot,
        "packages",
        name.replace("@pantry/", ""),
        "package.json",
      );
      const { main } = require(manifest) as { main?: string };
      const shipsDist = typeof main === "string" && main.includes("dist");

      expect({ name, mapped: name in WORKSPACE_SOURCE_DIRS }).toEqual({
        name,
        mapped: shipsDist,
      });
    }
  });
});

describe("relative imports inside a workspace source tree", () => {
  // The packages compile with TypeScript's `.js`-extension convention, so their
  // own sources import files that only exist after a build.
  const tokensIndex = path.join(workspaceRoot, "packages", "design-tokens", "src", "index.ts");

  it("maps a .js specifier onto its .ts sibling", () => {
    const resolved = resolve(tokensIndex, "./colors.js");

    expect(relativeToRoot(resolved as string)).toBe(
      path.join("packages", "design-tokens", "src", "colors.ts"),
    );
  });

  it("leaves relative imports in this app alone", () => {
    // `.js` here means a real `.js` file; rewriting it would be wrong.
    expect(resolve(fromApp, "./whatever.js")).toBeNull();
  });
});

describe("everything else falls through to Metro", () => {
  it.each(["react", "react-native", "expo-router", "convex/react", "@pantry/convex/api"])(
    "declines %s",
    (moduleName) => {
      expect(resolve(fromApp, moduleName)).toBeNull();
    },
  );

  it("declines @pantry/convex because it has no build step to go stale", () => {
    const generated = path.join(
      workspaceRoot,
      "packages",
      "convex",
      "convex",
      "_generated",
      "api.js",
    );
    expect(existsSync(generated)).toBe(true);
    expect(WORKSPACE_SOURCE_DIRS).not.toHaveProperty("@pantry/convex");
  });
});
