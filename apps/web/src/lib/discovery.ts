/**
 * Client-side helpers for the discovery metadata added in BL-0020.
 *
 * recipe-service owns normalization — it slugifies cuisines and tags so that
 * "Gluten Free" and "gluten_free" become one chip. These helpers only handle
 * the two things that are genuinely the client's job: turning a text field into
 * a wire value, and turning a stored slug back into something readable.
 */

/** Matches recipe-service's accepted range (a week); it rejects anything outside. */
export const MAX_TOTAL_MINUTES = 60 * 24 * 7;

/**
 * Reads the cook-time input into the wire value. Blank maps to undefined, and
 * so does anything that is not a whole count in range — the field is optional,
 * so treating junk as "unknown" beats sending it on for a 400. Mirrors
 * parseServings exactly, because the two fields have the same contract.
 */
export function parseTotalMinutes(input: string): number | undefined {
  const trimmed = input.trim();
  if (trimmed === "") return undefined;
  const n = Number(trimmed);
  if (!Number.isInteger(n) || n < 1 || n > MAX_TOTAL_MINUTES) return undefined;
  return n;
}

/** Renders a stored cook time back into the input's string state. */
export function formatTotalMinutes(totalMinutes: number | undefined): string {
  return totalMinutes === undefined ? "" : String(totalMinutes);
}

/**
 * Splits the tag input into a list. Commas are the separator people reach for,
 * and the service slugifies each entry anyway, so this only has to break the
 * string apart and drop the blanks.
 */
export function parseTags(input: string): string[] {
  return input
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t !== "");
}

/** Renders a stored tag list back into the input's string state. */
export function formatTags(tags: string[] | undefined): string {
  return (tags ?? []).join(", ");
}

/**
 * Renders a slug for display: "gluten-free" -> "Gluten Free". Purely cosmetic —
 * the slug remains the identity, and nothing is ever matched on the label.
 */
export function humanizeSlug(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** "1 h 25 min" reads better than "85 min" once a recipe passes an hour. */
export function formatDuration(totalMinutes: number): string {
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`;
}

/**
 * The tags rendered as the "Diet" chip row.
 *
 * This is a UI grouping, not a schema constraint: `tags` stays an open
 * vocabulary server-side, and a tag that is not listed here is still stored,
 * still shown on the recipe, and still matched by the search box — it simply
 * does not get its own filter chip. Adding one here is a one-line change, which
 * is the point of not encoding diet as an enum in the database.
 */
export const DIET_TAGS = [
  "vegetarian",
  "vegan",
  "pescatarian",
  "gluten-free",
  "dairy-free",
  "nut-free",
] as const;

/**
 * Cook-time filter buckets, in the order a weeknight cook scans them. Each is
 * an upper bound in minutes: "under 30" includes a 20-minute recipe.
 *
 * A recipe with no stated cook time matches NO bucket. That is deliberate:
 * "unknown" must not be quietly rounded into "fast", or the filter that exists
 * to answer "what can I cook tonight" starts lying.
 */
export const COOK_TIME_BUCKETS = [
  { id: "15", label: "Under 15 min", maxMinutes: 15 },
  { id: "30", label: "Under 30 min", maxMinutes: 30 },
  { id: "60", label: "Under 1 hour", maxMinutes: 60 },
] as const;

export type CookTimeBucketId = (typeof COOK_TIME_BUCKETS)[number]["id"];
