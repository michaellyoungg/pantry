/**
 * Guards the repo's oxlint configuration against three failure modes that are
 * all *silent* — the lint run stays green while enforcement quietly stops.
 *
 * This package is the reason the test exists. `packages/core` is headless by
 * contract (no DOM, no renderer, no React outside `src/react` and `src/data`),
 * and that contract is enforced by nothing but `.oxlintrc.json`. If the config
 * stops applying, the boundary erodes with no signal at all — which is exactly
 * what happened to each of the three cases below during the Biome -> oxc move.
 */

import { readFileSync } from "node:fs";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const config = JSON.parse(readFileSync(join(repoRoot, ".oxlintrc.json"), "utf8"));

/** Every rule name oxlint knows about, taken from the binary's own schema. */
function knownRuleNames(): Set<string> {
  const schema = JSON.parse(
    readFileSync(join(repoRoot, "node_modules/oxlint/configuration_schema.json"), "utf8"),
  );

  // The rule map is the one object whose properties include the eslint core
  // rules; find it structurally rather than pinning a path that oxlint may
  // reshape between releases.
  const find = (node: unknown): Set<string> | null => {
    if (node === null || typeof node !== "object") return null;
    const record = node as Record<string, unknown>;
    const properties = record.properties;
    if (
      properties !== null &&
      typeof properties === "object" &&
      "no-restricted-globals" in (properties as Record<string, unknown>)
    ) {
      return new Set(Object.keys(properties as Record<string, unknown>));
    }
    for (const value of Object.values(record)) {
      const found = find(value);
      if (found !== null) return found;
    }
    return null;
  };

  const names = find(schema);
  if (names === null) throw new Error("could not locate the rule map in oxlint's schema");
  return names;
}

/** `rules` blocks in the config: the top-level one plus every override's. */
function everyRulesBlock(): { where: string; rules: Record<string, unknown> }[] {
  const blocks = [{ where: "rules", rules: config.rules ?? {} }];
  for (const [i, override] of (config.overrides ?? []).entries()) {
    blocks.push({ where: `overrides[${i}].rules`, rules: override.rules ?? {} });
  }
  return blocks;
}

describe("oxlint configuration", () => {
  /**
   * A single unknown rule name makes oxlint discard the WHOLE `rules` object it
   * appears in — every other rule in that block silently stops applying. The
   * name that cost us an afternoon: `react-hooks/exhaustive-deps`, which is how
   * the diagnostic prints but not how the rule is configured
   * (`react/exhaustive-deps`).
   */
  it("names only rules oxlint actually knows", () => {
    const known = knownRuleNames();
    const unknown: string[] = [];

    for (const { where, rules } of everyRulesBlock()) {
      for (const name of Object.keys(rules)) {
        if (!known.has(name)) unknown.push(`${where}: ${name}`);
      }
    }

    expect(unknown).toEqual([]);
  });

  /**
   * oxlint `overrides` REPLACE a rule's options rather than merging them the way
   * Biome layered its two overrides. Both overrides that scope this package
   * therefore have to restate the `react-dom` / stylesheet ban; dropping it from
   * the narrower one silently un-bans both for every file it matches — which is
   * the strictest zone, everything outside `src/react` and `src/data`.
   */
  it("restates the headless import ban in every packages/core override", () => {
    const coreOverrides = (config.overrides ?? []).filter((override: { files: string[] }) =>
      override.files.some((glob) => glob.includes("packages/core")),
    );

    expect(coreOverrides.length).toBeGreaterThan(0);

    for (const override of coreOverrides) {
      const restricted = override.rules?.["no-restricted-imports"];
      if (restricted === undefined) continue;

      const groups = (restricted[1]?.patterns ?? []).flatMap(
        (pattern: { group: string[] }) => pattern.group,
      );
      expect(groups).toContain("react-dom");
      expect(groups).toContain("**/*.css");
    }
  });

  /**
   * A nested `.oxlintrc.json` REPLACES the root config for its whole subtree, so
   * one stray file disables every rule configured here for that app. `apps/web`
   * shipped one from the Vite React scaffold; it sat inert while the repo linted
   * with Biome and silently took over the moment oxlint started running.
   */
  it("has no nested config shadowing the root one", () => {
    const nested: string[] = [];
    const skip = new Set(["node_modules", ".git", ".turbo", "dist", ".claude"]);

    const walk = (dir: string, relative: string) => {
      for (const entry of readdirSync(dir)) {
        if (skip.has(entry)) continue;
        const absolute = join(dir, entry);
        if (statSync(absolute).isDirectory()) {
          walk(absolute, `${relative}${entry}/`);
        } else if (entry === ".oxlintrc.json" && relative !== "") {
          nested.push(`${relative}${entry}`);
        }
      }
    };

    walk(repoRoot, "");
    expect(nested).toEqual([]);
  });
});
