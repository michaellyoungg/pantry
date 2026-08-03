/**
 * Servings is nullable end to end (BL-0035). A blank field means "yield
 * unknown", which is a different thing from zero — every per-serving figure
 * downstream is omitted rather than computed when it is unknown.
 */

/** Matches recipe-service's accepted range; it rejects anything outside it. */
export const MAX_SERVINGS = 100;

/**
 * Reads the servings input into the wire value. Blank maps to undefined, and so
 * does anything that is not a whole count in range — the field is optional, so
 * treating junk as "unknown" is better than sending it on for a 400.
 */
export function parseServings(input: string): number | undefined {
  const trimmed = input.trim();
  if (trimmed === "") return undefined;
  const n = Number(trimmed);
  if (!Number.isInteger(n) || n < 1 || n > MAX_SERVINGS) return undefined;
  return n;
}

/** Renders a stored servings count back into the input's string state. */
export function formatServings(servings: number | undefined): string {
  return servings === undefined ? "" : String(servings);
}
