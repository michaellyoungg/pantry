/**
 * Paths Metro's file crawler must not walk.
 *
 * `metro.config.js` sets `watchFolders = [workspaceRoot]` so edits in
 * `packages/*` hot-reload. The cost is that Metro's crawler walks EVERYTHING
 * under the monorepo root — including `.data/`, where `docker-compose` keeps the
 * Postgres and Convex volumes.
 *
 * Postgres refuses to start unless its data directory is `drwx------`, and it
 * owns that directory as the container's uid, not yours. So the crawl hits a
 * directory it cannot read and `expo start` dies before Metro is listening:
 *
 *     Error: EACCES: permission denied, scandir '<root>/.data/postgres'
 *
 * It looks intermittent, which is the trap. A checkout that has never run
 * `docker compose up` has no `.data/`, so Metro starts fine there — which is
 * exactly the state a fresh worktree or a CI runner is in. It only bites the
 * checkout that is *also* running the backend, i.e. anyone actually developing
 * against the stack.
 *
 * Chmod is not the fix: loosening the Postgres directory makes Postgres refuse
 * to start. The directory is legitimately unreadable, so Metro has to skip it.
 */
const path = require("node:path");

/** Escapes a filesystem path for literal use inside a RegExp. */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A RegExp matching everything under `<workspaceRoot>/.data`.
 *
 * Metro applies `resolver.blockList` to the file map, so a match here keeps the
 * crawler out rather than merely hiding the files from resolution.
 */
function dockerVolumePattern(workspaceRoot) {
  const dataDir = path.resolve(workspaceRoot, ".data");
  return new RegExp(`^${escapeRegExp(dataDir + path.sep)}.*`);
}

/**
 * Merges the pattern above into whatever Metro already had.
 *
 * `blockList` arrives as a RegExp, an array of them, or undefined depending on
 * the preset, so it is normalised rather than assumed — overwriting it would
 * silently drop Metro's own exclusions.
 */
function withDockerVolumesBlocked(existing, workspaceRoot) {
  const current = existing == null ? [] : Array.isArray(existing) ? existing : [existing];
  return [...current, dockerVolumePattern(workspaceRoot)];
}

module.exports = { dockerVolumePattern, withDockerVolumesBlocked };
