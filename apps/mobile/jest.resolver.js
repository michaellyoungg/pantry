/**
 * Jest resolution for workspace packages.
 *
 * This reuses the *same* resolver Metro uses (`metro.workspace-source.js`)
 * rather than restating the mapping as `moduleNameMapper` entries. Two copies
 * of a resolution rule drift, and the failure when they do is a test suite that
 * passes against `dist/` while the simulator runs `src/` — precisely the class
 * of bug that config exists to prevent.
 *
 * Everything else is delegated to the resolver `jest-expo` installs, not to
 * Jest's default: React Native's resolver is what applies platform extensions
 * (`.ios.js`, `.android.js`) and the `react-native` export condition, so
 * replacing it outright breaks resolution inside React Native itself.
 */
const path = require("node:path");
const { createWorkspaceSourceResolver } = require("./metro.workspace-source");

const workspaceRoot = path.resolve(__dirname, "../..");
const resolveWorkspaceSource = createWorkspaceSourceResolver(workspaceRoot);

// Read the path off the preset rather than importing by name: with pnpm,
// @react-native/jest-preset is nested under react-native and is not resolvable
// from this app's own node_modules.
const expoResolver = require(require("jest-expo/jest-preset").resolver);

module.exports = (request, options) => {
  // Jest hands us the importing *directory*; the shared resolver wants an
  // importing file, and only uses its dirname.
  const originModulePath = path.join(options.basedir, "__jest_origin__");
  const sourceFile = resolveWorkspaceSource(originModulePath, request);
  if (sourceFile !== null) return sourceFile;

  return expoResolver(request, options);
};
