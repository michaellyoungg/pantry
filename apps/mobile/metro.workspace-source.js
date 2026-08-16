/**
 * Metro resolution for this repo's pnpm workspace packages.
 *
 * The problem this solves
 * ----------------------
 * `@pantry/core` & friends publish `dist/` through their `exports` map, and
 * `dist/` is produced by `turbo run build`. Metro has no build step, so with
 * default resolution the simulator runs whatever `dist/` happened to be on disk
 * — which is a *stale build*, not the source you just edited. This repo has
 * already been bitten twice by that failure mode, and it is nasty precisely
 * because `tsc` reads the same stale `.d.ts` and stays green: a runtime error
 * with no type error.
 *
 * So Metro resolves these packages to their `src/` instead. There is then no
 * build artifact to go stale, and no dependency on turbo task ordering.
 *
 * Two rewrites are needed, not one
 * --------------------------------
 * 1. The package specifier itself: `@pantry/core/react` -> `packages/core/src/react`.
 * 2. The *relative* imports inside those sources. The packages compile with
 *    TypeScript's `.js`-extension convention (`export … from "./colors.js"`),
 *    which points at a file that only exists after a build. Inside a workspace
 *    source tree we strip that extension and let Metro pick the `.ts` sibling.
 *
 * Skipping (2) is the classic way this configuration half-works: the entry
 * point resolves, the first relative import inside it does not.
 *
 * `@pantry/convex` is deliberately absent from the map below — it has no build
 * step at all. It exports `convex/_generated/*.js`, which are checked-in
 * generated sources, so default resolution is already correct for it.
 */

const fs = require("node:fs");
const path = require("node:path");

/** Extensions tried when resolving an extensionless path, in priority order. */
const SOURCE_EXTS = [".ts", ".tsx", ".js", ".jsx", ".json"];

/**
 * Workspace packages Metro should read from source, as package name -> source
 * directory, relative to the repo root.
 *
 * Adding a `@pantry/*` package that ships a `dist/` means adding it here.
 * `workspaceSource.test.ts` asserts this map stays in step with the packages
 * `apps/mobile` actually depends on, so the omission fails CI rather than the
 * simulator.
 */
const WORKSPACE_SOURCE_DIRS = {
  "@pantry/core": "packages/core/src",
  "@pantry/design-tokens": "packages/design-tokens/src",
  "@pantry/types": "packages/types/src",
};

/** Resolve `basePath` to a real file, trying it bare, then with each extension, then as a directory. */
function resolveSourceFile(basePath, exists = fs.existsSync) {
  if (exists(basePath) && isFile(basePath)) return basePath;

  for (const ext of SOURCE_EXTS) {
    const candidate = basePath + ext;
    if (exists(candidate)) return candidate;
  }

  for (const ext of SOURCE_EXTS) {
    const candidate = path.join(basePath, `index${ext}`);
    if (exists(candidate)) return candidate;
  }

  return null;
}

function isFile(candidate) {
  try {
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

/**
 * Builds the source-first resolver.
 *
 * @param {string} workspaceRoot Absolute path to the repo root.
 * @param {(p: string) => boolean} [exists] Injectable for tests.
 * @returns {(originModulePath: string | undefined, moduleName: string) => string | null}
 *   The absolute source file to use, or `null` to fall through to Metro's own
 *   resolution. Falling through is always the safe answer — this resolver only
 *   ever *redirects*, it never fails a request.
 */
function createWorkspaceSourceResolver(workspaceRoot, exists = fs.existsSync) {
  const sourceRoots = Object.fromEntries(
    Object.entries(WORKSPACE_SOURCE_DIRS).map(([pkg, dir]) => [pkg, path.join(workspaceRoot, dir)]),
  );
  const allRoots = Object.values(sourceRoots);

  const isInsideWorkspaceSource = (filePath) =>
    allRoots.some((root) => filePath === root || filePath.startsWith(root + path.sep));

  return function resolveWorkspaceSource(originModulePath, moduleName) {
    // (1) A workspace package specifier, with or without a subpath export.
    for (const [pkg, sourceRoot] of Object.entries(sourceRoots)) {
      if (moduleName !== pkg && !moduleName.startsWith(`${pkg}/`)) continue;

      const subpath = moduleName.slice(pkg.length).replace(/^\//, "");
      const target = subpath ? path.join(sourceRoot, subpath) : sourceRoot;
      return resolveSourceFile(target, exists);
    }

    // (2) A relative import *from inside* one of those source trees. Only here
    // is it safe to strip a `.js` extension: elsewhere in the app a `.js`
    // request means a real `.js` file.
    if (
      moduleName.startsWith(".") &&
      originModulePath &&
      isInsideWorkspaceSource(originModulePath)
    ) {
      const absolute = path.resolve(path.dirname(originModulePath), moduleName);
      return resolveSourceFile(absolute.replace(/\.(js|jsx)$/, ""), exists);
    }

    return null;
  };
}

module.exports = {
  WORKSPACE_SOURCE_DIRS,
  createWorkspaceSourceResolver,
};
