const path = require("node:path");

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Paths under the workspace root that Metro's crawler must skip.
 *
 * `.data/` holds the docker-compose volumes, and Postgres requires its own to be
 * `drwx------`, so crawling it throws EACCES before Metro listens. `.claude/`
 * holds sibling worktrees — whole extra copies of this monorepo, `.data/` and
 * all.
 */
function crawlerIgnorePatterns(workspaceRoot) {
  const root = escapeRegExp(path.resolve(workspaceRoot) + path.sep);
  const sep = escapeRegExp(path.sep);
  return [
    new RegExp(`^${root}(?:.*${sep})?\\.data${sep}.*`),
    new RegExp(`^${root}\\.claude${sep}.*`),
  ];
}

/** Metro's `blockList` is a RegExp, an array, or unset depending on the preset. */
function withIgnoredPathsBlocked(existing, workspaceRoot) {
  const current = existing == null ? [] : Array.isArray(existing) ? existing : [existing];
  return [...current, ...crawlerIgnorePatterns(workspaceRoot)];
}

module.exports = { crawlerIgnorePatterns, withIgnoredPathsBlocked };
