import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { TEST_ID_PATTERN, testID } from "../testing/testIDs";
import { NAV_ITEMS } from "./navItems";

const appRoot = path.resolve(__dirname, "../..");

describe("NAV_ITEMS", () => {
  it("mirrors the web app's seven navigation entries, in order", () => {
    // Read rather than imported: `apps/web` is not a dependency of `apps/mobile`
    // and must not become one. This asserts the parity claim without creating
    // the coupling — if either client's nav changes, this fails and someone
    // decides deliberately whether the two should still match.
    const navSource = readFileSync(path.resolve(appRoot, "../web/src/components/Nav.tsx"), "utf8");
    const webEntries = [...navSource.matchAll(/\{\s*to:\s*"([^"]+)",\s*label:\s*"([^"]+)"/g)].map(
      ([, to, label]) => ({ to, label }),
    );

    expect(webEntries).toHaveLength(7);
    expect(NAV_ITEMS.map((item) => ({ to: item.webPath, label: item.label }))).toEqual(webEntries);
  });

  it("has a route file for every tab", () => {
    for (const item of NAV_ITEMS) {
      expect(existsSync(path.join(appRoot, "app", "(tabs)", `${item.name}.tsx`))).toBe(true);
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
