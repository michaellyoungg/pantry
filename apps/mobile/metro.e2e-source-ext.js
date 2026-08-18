/**
 * Build-time module substitution for e2e builds (BL-0072).
 *
 * With `PANTRY_E2E=1`, Metro prefers `foo.e2e.ts` over `foo.ts`, so a module a
 * UI test cannot drive — push notification registration, reminder scheduling —
 * can be swapped at bundle time rather than mocked at runtime. Bluesky does
 * this with `RN_SRC_EXT=e2e.ts,e2e.tsx`.
 *
 * **Copying that env var here would do nothing.** `RN_SRC_EXT` is a
 * bare-React-Native convention and appears nowhere in the installed Expo
 * toolchain — not `@expo/metro-config`, not `metro-config`, not
 * `babel-preset-expo`. Under Expo the extension list is whatever
 * `metro.config.js` leaves in `resolver.sourceExts`, so it has to be wired by
 * hand.
 *
 * There is no `*.e2e.ts` in the tree yet. The seam is here so the first module
 * that needs one is a one-file change rather than a build-system change made
 * while a nightly is red, and it is tested for the same reason.
 */

/** Set by scripts/mobile-e2e.sh. Not `RN_SRC_EXT`, which would imply the above. */
const E2E_ENV_FLAG = "PANTRY_E2E";

const E2E_INFIX = "e2e";

/**
 * Passed in rather than read off the global so the behaviour is testable, and
 * typed loosely because `process.env`'s own type insists on `NODE_ENV`.
 *
 * @typedef {Record<string, string | undefined>} Env
 */

/** @param {Env} env */
function isE2EBuild(env) {
  return env[E2E_ENV_FLAG] === "1";
}

/**
 * `["ts", "tsx", …]` -> `["e2e.ts", "e2e.tsx", …, "ts", "tsx", …]`.
 *
 * Derived from what Metro already had, so an extension Expo adds later is
 * substitutable without anyone remembering this file.
 *
 * Every `e2e.*` must precede every plain one. Interleaving them looks
 * equivalent and is not: `ts` would come before `e2e.tsx`, so a `.tsx` module
 * with both a `.ts` sibling and a `.e2e.tsx` twin would resolve to the real one.
 *
 * @param {string[]} sourceExts
 * @param {Env} [env]
 * @returns {string[]}
 */
function e2eSourceExts(sourceExts, env = process.env) {
  if (!isE2EBuild(env)) return sourceExts;
  return [...sourceExts.map((ext) => `${E2E_INFIX}.${ext}`), ...sourceExts];
}

/**
 * Applies the substitution, announcing itself when it fires.
 *
 * The announcement is not decoration: a stray `PANTRY_E2E=1` in a shell builds
 * test doubles into the app, and "a feature that quietly does nothing" reads as
 * a bug in that feature. Mutates rather than copies, like the rest of
 * `metro.config.js`, so nothing another wrapper attached is dropped.
 *
 * @template {{ resolver: { sourceExts: string[] } }} T
 * @param {T} config
 * @param {Env} [env]
 * @returns {T}
 */
function applyE2ESourceExts(config, env = process.env) {
  if (!isE2EBuild(env)) return config;

  console.log(`[${E2E_ENV_FLAG}] e2e build: *.${E2E_INFIX}.* modules take precedence`);
  config.resolver.sourceExts = e2eSourceExts(config.resolver.sourceExts, env);
  return config;
}

module.exports = { applyE2ESourceExts, E2E_ENV_FLAG, e2eSourceExts, isE2EBuild };
