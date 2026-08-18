import path from "node:path";
import { crawlerIgnorePatterns, withIgnoredPathsBlocked } from "./metro.crawler-ignore";

const ROOT = path.resolve("/repo");
const under = (...parts: string[]) => path.join(ROOT, ...parts);
const blocks = (p: string) => crawlerIgnorePatterns(ROOT).some((re) => re.test(p));

describe("crawlerIgnorePatterns", () => {
  it("blocks the compose volumes at the root", () => {
    expect(blocks(under(".data", "postgres", "base", "1"))).toBe(true);
    expect(blocks(under(".data", "convex", "db.sqlite3"))).toBe(true);
  });

  it("blocks a sibling worktree's own volumes", () => {
    // The root-anchored pattern alone missed these and Metro still died.
    expect(blocks(under(".claude", "worktrees", "wt-1", ".data", "postgres"))).toBe(true);
    expect(blocks(path.join(ROOT, "nested", ".data", "postgres"))).toBe(true);
  });

  it("blocks sibling worktree sources, which are duplicate copies of this repo", () => {
    expect(blocks(under(".claude", "worktrees", "wt-1", "packages", "core", "src", "x.ts"))).toBe(
      true,
    );
  });

  it("does not block workspace source", () => {
    expect(blocks(under("packages", "core", "src", "index.ts"))).toBe(false);
    expect(blocks(under("apps", "mobile", "app", "_layout.tsx"))).toBe(false);
    expect(blocks(under(".database", "schema.ts"))).toBe(false);
  });

  it("is anchored to this workspace", () => {
    expect(blocks(path.join("/elsewhere", ".data", "postgres"))).toBe(false);
  });
});

describe("withIgnoredPathsBlocked", () => {
  it("keeps a preset's own exclusions", () => {
    const existing = /node_modules\/.*\/__fixtures__\/.*/;

    expect(withIgnoredPathsBlocked(existing, ROOT)[0]).toBe(existing);
    expect(withIgnoredPathsBlocked([/a/, /b/], ROOT).slice(0, 2)).toEqual([/a/, /b/]);
  });

  it("handles a preset that sets none", () => {
    expect(withIgnoredPathsBlocked(undefined, ROOT)).toHaveLength(2);
    expect(withIgnoredPathsBlocked(null, ROOT)).toHaveLength(2);
  });
});
