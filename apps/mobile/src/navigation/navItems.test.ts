import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { NAV_ITEMS as SHARED_NAV_ITEMS } from "@pantry/core";
import { TEST_ID_PATTERN, testID } from "../testing/testIDs";
import { cookModeHref, NAV_ITEMS, recipeHref, tabHref, tabTestID } from "./navItems";

const appRoot = path.resolve(__dirname, "../..");

describe("NAV_ITEMS", () => {
  it("derives order, labels, and icons from the shared list", () => {
    // BL-0054: the destinations live in `@pantry/core`, which `apps/mobile`
    // already depends on, so parity is now structural rather than asserted
    // against a copy. What this still guards is the join: every shared
    // destination must surface as exactly one tab, in the same order.
    expect(
      NAV_ITEMS.map((item) => ({ to: item.webPath, label: item.label, icon: item.icon })),
    ).toEqual(
      SHARED_NAV_ITEMS.map((item) => ({ to: item.to, label: item.label, icon: item.icon })),
    );
  });

  it("names an icon rather than embedding a glyph", () => {
    // Rule 7 of 2026-07-18-mobile-client-design.md — emoji render differently
    // on iOS and Android, which is what made this a mobile problem at all.
    for (const item of NAV_ITEMS) {
      expect(item.icon).toMatch(/^[A-Z][A-Za-z]+$/);
    }
  });

  it("has a route file for every tab", () => {
    for (const item of NAV_ITEMS) {
      expect(existsSync(path.join(appRoot, "app", "(tabs)", `${item.name}.tsx`))).toBe(true);
    }
  });

  it("routes every destination to a tab this app actually has", () => {
    // The hrefs are hand-written per tab, so this is the assertion that keeps
    // them honest: each one must address the route file its tab renders. Home
    // is "/" rather than "/index" because the group's index route is the root.
    for (const item of NAV_ITEMS) {
      expect(tabHref(item.webPath)).toBe(item.name === "index" ? "/" : `/${item.name}`);
    }
  });

  it("points each placeholder at a backlog item that actually exists", () => {
    const backlog = path.resolve(appRoot, "../../docs/backlog");

    for (const item of NAV_ITEMS) {
      expect(item.portedBy).toMatch(/^BL-\d{4}$/);
      const matches = readdirSync(backlog).filter((file) => file.startsWith(`${item.portedBy}-`));
      expect({ tab: item.name, item: item.portedBy, found: matches.length }).toEqual({
        tab: item.name,
        item: item.portedBy,
        found: 1,
      });
    }
  });

  it("yields a valid tab testID for every entry", () => {
    // These are the strings `apps/mobile/e2e` taps to change tab, so a
    // malformed one is a broken flow rather than a cosmetic problem.
    for (const item of NAV_ITEMS) {
      expect(TEST_ID_PATTERN.test(tabTestID(item.name))).toBe(true);
    }
  });

  it("calls the index route's tab `home`, not `index`", () => {
    expect(tabTestID("index")).toBe(testID("nav", "tab", "home"));
    expect(tabTestID("pantry")).toBe(testID("nav", "tab", "pantry"));
  });
});

describe("the recipe hrefs", () => {
  // Same assertion as the tabs above, for the stack routes cooking mode adds
  // (BL-0061): a hand-written path has to address a route file that exists, or
  // the screen navigates into a 404 that nothing else catches.
  it("address route files this app actually has", () => {
    expect(existsSync(path.join(appRoot, "app", "recipe", "[id]", "index.tsx"))).toBe(true);
    expect(existsSync(path.join(appRoot, "app", "recipe", "[id]", "cook.tsx"))).toBe(true);
    expect(recipeHref("r1")).toBe("/recipe/r1");
    expect(cookModeHref("r1")).toBe("/recipe/r1/cook");
  });

  // Recipe ids come from recipe-service, not from this app, so a path is built
  // from them rather than from a closed union — which makes escaping this
  // file's job.
  it("escape an id rather than letting it change the path", () => {
    expect(recipeHref("a/b?c")).toBe("/recipe/a%2Fb%3Fc");
  });
});
