/**
 * The selector contract, for every client.
 *
 * React Native has no DOM and no ARIA roles, so the role- and text-based
 * locators `apps/web/e2e` leans on do not port: Maestro selects by `id:` and
 * React Native Testing Library by `getByTestId`. Both read `testID`. That makes
 * `testID` the *only* selector the native client has, and therefore API: a
 * rename breaks tests the same way a renamed exported function does.
 *
 * The scheme was established by BL-0056 before the first native screen existed,
 * inside `apps/mobile`. BL-0071 moved it here, because the web half needs the
 * same strings: `data-testid` on web, `testID` on native, built by one function
 * so the two clients cannot name the same thing differently. Nothing in this
 * module is platform-specific — it is string handling, and it lives in the
 * headless package for the same reason `NAV_ITEMS` does.
 *
 * Shape: `surface.element` with an optional `.key` for repeated rows.
 *
 *   testID("list", "generate-button")            -> "list.generate-button"
 *   testID("list", "item", "whole-milk")         -> "list.item.whole-milk"
 *
 * `sharedTestIDs.ts` names the elements both clients render; this module is
 * only the format. See `docs/mobile-testid-conventions.md`.
 */

/** Separator between segments. Dots, so a segment can contain a hyphen. */
const SEPARATOR = ".";

/**
 * Every surface that may own a `testID`. A closed set, because the value of the
 * namespace is that you can grep for `list.` and find every selector on the
 * grocery screen.
 *
 * The first seven mirror the web app's `NAV_ITEMS` route order.
 */
const TEST_ID_SURFACES = [
  "home",
  "plan",
  "recipes",
  "list",
  "pantry",
  "history",
  "settings",
  "nav",
  "auth",
  "app",
] as const;

export type TestIDSurface = (typeof TEST_ID_SURFACES)[number];

declare const testIDBrand: unique symbol;

/**
 * A string that came out of `testID()`.
 *
 * Branded so a component prop can demand one: a hand-written `"list.item"` then
 * fails to compile rather than quietly joining the contract unvalidated, and
 * the runtime check below cannot be routed around. It is still a `string`
 * everywhere it is used.
 */
export type TestID = string & { readonly [testIDBrand]: true };

/**
 * Lowercase, digits and single inner hyphens. Rejects the things that make a
 * selector unstable in practice: spaces, capitals (Android resource-ids are
 * case sensitive and easy to get wrong by hand), and anything that reads like
 * an index (`item-0`) rather than an identity.
 */
const SEGMENT = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Matches a well-formed id, for asserting on one without rebuilding it. */
export const TEST_ID_PATTERN = /^[a-z][a-z0-9]*(\.[a-z0-9]+(-[a-z0-9]+)*){1,2}$/;

/**
 * Builds a `testID`.
 *
 * @param surface Owning screen or shared surface.
 * @param element What the element *is* — `"generate-button"`, `"empty-state"`.
 *   Name the role, not the styling or the copy, so the selector survives both.
 * @param key Identity of one row in a repeated list. Must be derived from the
 *   data (a slug, a name), never from the array index: a positional id silently
 *   points at a different row as soon as the list reorders.
 */
export function testID(surface: TestIDSurface, element: string, key?: string): TestID {
  assertSegment(element, "element");
  if (key !== undefined) assertSegment(key, "key");

  const id =
    key === undefined
      ? `${surface}${SEPARATOR}${element}`
      : `${surface}${SEPARATOR}${element}${SEPARATOR}${key}`;
  return id as TestID;
}

/**
 * Binds `testID` to one surface, so a screen module reads
 * `const id = surfaceTestIDs("list")` and then `id("generate-button")`.
 */
export function surfaceTestIDs(surface: TestIDSurface) {
  return (element: string, key?: string) => testID(surface, element, key);
}

/**
 * The `surface.element.` stem shared by every keyed row of one repeated
 * element — `"list.item."`.
 *
 * For addressing the rows as a set when their keys are not known: a Playwright
 * `[data-testid^="list.item."]` counts the lines on the grocery list without
 * depending on them being `<li>`s, which is what made the old `listitem`
 * locators break whenever a neighbouring card grew a list of its own.
 */
export function testIDPrefix(surface: TestIDSurface, element: string): string {
  assertSegment(element, "element");
  return `${surface}${SEPARATOR}${element}${SEPARATOR}`;
}

/**
 * Normalises arbitrary data into a usable `key` segment.
 *
 * Grocery lines and pantry items are user-entered ("Whole Milk", "1% milk"), so
 * a caller almost always needs this rather than hand-writing the slug.
 */
export function testIDKey(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (slug === "") {
    throw new Error(`testIDKey: "${value}" has no alphanumeric content to slug`);
  }
  return slug;
}

function assertSegment(value: string, label: string): void {
  if (!SEGMENT.test(value)) {
    throw new Error(
      `testID ${label} "${value}" must be lowercase alphanumeric with single hyphens ` +
        "(see docs/mobile-testid-conventions.md). Use testIDKey() to slug user data.",
    );
  }
  // A bare number is the index smell. Dates and quantities legitimately contain
  // digits ("2026-08-16", "1-percent-milk"), so only a wholly numeric segment is
  // rejected; the wider "never key on position" rule is documentation, not regex.
  if (/^\d+$/.test(value)) {
    throw new Error(
      `testID ${label} "${value}" is positional. Derive keys from the data, not the array index, ` +
        "or a reordered list silently points the selector at a different row.",
    );
  }
}
