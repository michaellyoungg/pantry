import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { NAV_ITEMS as SHARED_NAV_ITEMS } from "@pantry/core";
import { TEST_ID_PATTERN, testID } from "../testing/testIDs";
import { NAV_ITEMS, tabHref } from "./navItems";

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
    for (const item of NAV_ITEMS) {
      const id = testID("nav", "tab", item.name === "index" ? "home" : item.name);
      expect(TEST_ID_PATTERN.test(id)).toBe(true);
    }
  });
});
