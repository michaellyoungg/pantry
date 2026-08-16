/**
 * `testID` is the selector contract for the native client.
 *
 * React Native has no DOM and no ARIA roles, so the role- and text-based
 * locators `apps/web/e2e` leans on do not port: Maestro selects by `id:` and
 * React Native Testing Library by `getByTestId`. Both read `testID`.
 *
 * This module exists *before* the first real screen deliberately. Retrofitting
 * a naming scheme across finished screens is strictly more expensive than
 * adopting one now, and an ad-hoc `testID` is indistinguishable from a stable
 * one until something breaks. See `docs/mobile-testid-conventions.md`.
 *
 * Shape: `surface.element` with an optional `.key` for repeated rows.
 *
 *   testID("list", "generate-button")            -> "list.generate-button"
 *   testID("list", "item", "whole-milk")         -> "list.item.whole-milk"
 *
 * The same strings are intended to be usable as web `data-testid` values
 * (BL-0071), so nothing here is React Native specific.
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
export function testID(surface: TestIDSurface, element: string, key?: string): string {
  assertSegment(element, "element");
  if (key !== undefined) assertSegment(key, "key");

  return key === undefined
    ? `${surface}${SEPARATOR}${element}`
    : `${surface}${SEPARATOR}${element}${SEPARATOR}${key}`;
}

/**
 * Binds `testID` to one surface, so a screen module reads
 * `const id = surfaceTestIDs("list")` and then `id("generate-button")`.
 */
export function surfaceTestIDs(surface: TestIDSurface) {
  return (element: string, key?: string) => testID(surface, element, key);
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
