/**
 * `expo start` dies with `EACCES: scandir '<root>/.data/postgres'` without this
 * exclusion, and it dies at crawler startup — there is no partial success to
 * notice. The regression is invisible to every other suite, so the pattern is
 * asserted directly. See metro.crawler-ignore.js for the why.
 */
import path from "node:path";
import { dockerVolumePattern, withDockerVolumesBlocked } from "./metro.crawler-ignore";

const ROOT = path.resolve("/repo");
const under = (...parts: string[]) => path.join(ROOT, ...parts);

describe("dockerVolumePattern", () => {
  const pattern = dockerVolumePattern(ROOT);

  it("blocks the postgres volume that actually breaks the crawl", () => {
    expect(pattern.test(under(".data", "postgres"))).toBe(true);
    expect(pattern.test(under(".data", "postgres", "base", "1"))).toBe(true);
  });

  it("blocks the other compose volumes under .data", () => {
    expect(pattern.test(under(".data", "convex", "db.sqlite3"))).toBe(true);
  });

  it("does not block workspace source", () => {
    expect(pattern.test(under("packages", "core", "src", "index.ts"))).toBe(false);
    expect(pattern.test(under("apps", "mobile", "app", "_layout.tsx"))).toBe(false);
  });

  it("does not block a directory that merely starts with the same letters", () => {
    // `.data` must be a whole path segment — `.database/` is somebody's source.
    expect(pattern.test(under(".database", "schema.ts"))).toBe(false);
  });

  it("is anchored to this workspace, not any `.data` anywhere", () => {
    expect(pattern.test(path.join("/elsewhere", ".data", "postgres"))).toBe(false);
  });
});

describe("withDockerVolumesBlocked", () => {
  it("keeps Metro's own exclusions when they are a bare RegExp", () => {
    const existing = /node_modules\/.*\/__fixtures__\/.*/;

    const merged = withDockerVolumesBlocked(existing, ROOT);

    expect(merged).toHaveLength(2);
    expect(merged[0]).toBe(existing);
    expect(merged.some((re) => re.test(under(".data", "postgres")))).toBe(true);
  });

  it("keeps Metro's own exclusions when they are an array", () => {
    const existing = [/a/, /b/];

    const merged = withDockerVolumesBlocked(existing, ROOT);

    expect(merged.slice(0, 2)).toEqual(existing);
    expect(merged).toHaveLength(3);
  });

  it("handles a preset that sets no blockList at all", () => {
    expect(withDockerVolumesBlocked(undefined, ROOT)).toHaveLength(1);
    expect(withDockerVolumesBlocked(null, ROOT)).toHaveLength(1);
  });
});
