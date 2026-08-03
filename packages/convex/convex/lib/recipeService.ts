// Calls recipe-service as Convex: proves identity with the shared secret and
// forwards the authenticated user id. Never reachable from the browser.
// When a `traceparent` is supplied it rides along so the Go span (BL-0027)
// nests under the Convex span.
//
// recipes.ts carries a private copy of this helper. It is deliberately not
// refactored to import this one here: that file is being edited concurrently
// for other backlog items, and a shared-helper migration is a change to every
// call site in it. Unify them once those land.
export async function recipeServiceFetch<T>(
  userId: string,
  method: string,
  path: string,
  body?: unknown,
  traceparent?: string,
): Promise<T> {
  const baseUrl = process.env.RECIPE_SERVICE_URL;
  if (!baseUrl) throw new Error("RECIPE_SERVICE_URL is not set on the deployment");
  const secret = process.env.RECIPE_SERVICE_SECRET;
  if (!secret) throw new Error("RECIPE_SERVICE_SECRET is not set on the deployment");

  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "X-Service-Secret": secret,
      "X-User-Id": userId,
      ...(traceparent ? { traceparent } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`recipe-service ${method} ${path} failed: ${res.status}`);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** One entry of POST /normalization/lookup. `shelfLifeDays` is absent when unknown. */
export interface NormalizedItem {
  canonicalItem: string;
  display: string;
  aisle: string;
  shelfLifeDays?: number;
}

/**
 * Resolve approximate shelf life for a set of canonical items, as
 * canonicalItem -> days. Items recipe-service doesn't recognize are simply
 * absent from the result — never defaulted, because a guessed date is worse
 * than no date (BL-0029).
 */
export async function lookupShelfLife(
  userId: string,
  items: string[],
  traceparent?: string,
): Promise<Record<string, number>> {
  if (items.length === 0) return {};
  const res = await recipeServiceFetch<{ items: NormalizedItem[] }>(
    userId,
    "POST",
    "/normalization/lookup",
    { items },
    traceparent,
  );
  const out: Record<string, number> = {};
  for (const item of res.items ?? []) {
    if (item.shelfLifeDays !== undefined) out[item.canonicalItem] = item.shelfLifeDays;
  }
  return out;
}
