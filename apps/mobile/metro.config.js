// Learn more: https://docs.expo.dev/guides/monorepos/
const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");
const { createWorkspaceSourceResolver } = require("./metro.workspace-source");
const { withIgnoredPathsBlocked } = require("./metro.crawler-ignore");
const { applyE2ESourceExts } = require("./metro.e2e-source-ext");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

// --- pnpm workspace -------------------------------------------------------
// Metro only watches the project root by default, so edits to packages/* would
// neither rebuild nor hot-reload.
config.watchFolders = [workspaceRoot];

// Watching the root means crawling it; see metro.crawler-ignore.js for what must
// be skipped and why.
config.resolver.blockList = withIgnoredPathsBlocked(config.resolver.blockList, workspaceRoot);

// pnpm puts a package's own dependencies in a nested `node_modules` inside the
// virtual store, so hierarchical lookup must stay ON (the usual
// `disableHierarchicalLookup: true` monorepo advice is for npm/yarn hoisting and
// breaks pnpm). These two paths are the fallback for the workspace root.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];

// pnpm's store is a symlink farm; Metro must follow the links to the real files.
config.resolver.unstable_enableSymlinks = true;
config.resolver.unstable_enablePackageExports = true;

// --- workspace packages resolve to source, never to dist/ -----------------
// See metro.workspace-source.js for why. Anything this resolver declines is
// handed straight back to Metro.
const resolveWorkspaceSource = createWorkspaceSourceResolver(workspaceRoot);
const defaultResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const sourceFile = resolveWorkspaceSource(context.originModulePath, moduleName);
  if (sourceFile !== null) {
    return { type: "sourceFile", filePath: sourceFile };
  }
  return (defaultResolveRequest ?? context.resolveRequest)(context, moduleName, platform);
};

// --- e2e builds -----------------------------------------------------------
// Inert unless PANTRY_E2E=1, which only scripts/mobile-e2e.sh sets. See
// metro.e2e-source-ext.js for what it swaps, and for why copying Bluesky's
// RN_SRC_EXT would do nothing under Expo.
applyE2ESourceExts(config);

module.exports = withNativeWind(config, { input: "./global.css" });
