import { api } from "@pantry/convex/api";
import { useAsyncData } from "@pantry/core/react";
import { Link } from "@tanstack/react-router";
import { useAction, useQuery } from "convex/react";
import { useCallback } from "react";
import { expiringSoon, formatUseBy, isOverdue, type PantryRow } from "../lib/expiry";

/**
 * The whole expiry nudge (BL-0029), in ONE card: "N items to use this week →
 * cook these".
 *
 * Two rules the design is explicit about:
 *  - **Batched, never per-item.** A badge on every row is a stream of nags the
 *    user learns to ignore; one prompt with a count is a decision they can act on.
 *  - **Actionable.** An expiry alert with nothing to do about it is just guilt,
 *    so the card's payload is recipes that actually use the expiring items.
 *
 * It renders NOTHING when nothing is expiring — no empty state, no zero badge.
 */
export function UseItUp() {
  const rows = (useQuery(api.pantry.list) ?? []) as PantryRow[];
  const recipesToUse = useAction(api.pantry.recipesToUse);

  const now = Date.now();
  const batch = expiringSoon(rows, now);

  // The item set is carried through the dependency list as a serialized string:
  // the array itself is a fresh reference on every render, which would re-request
  // recipes forever, and a string compares by value. Round-tripping through JSON
  // (rather than a join/split) keeps items containing separators intact.
  const itemsKey = JSON.stringify(batch.map((r) => r.canonicalItem));
  const load = useCallback(() => {
    const items = JSON.parse(itemsKey) as string[];
    return items.length === 0 ? Promise.resolve([]) : recipesToUse({ items });
  }, [itemsKey, recipesToUse]);
  const { data: recipes, loading } = useAsyncData(load);

  if (batch.length === 0) return null;

  return (
    <section
      aria-label="Use it up"
      className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-5 shadow-sm"
    >
      <h2 className="text-lg font-semibold text-text">
        {batch.length === 1 ? "1 item to use this week" : `${batch.length} items to use this week`}
      </h2>

      <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
        {batch.map((row) => (
          <li key={row._id} className="text-sm text-text">
            {row.display}{" "}
            <span
              className={
                row.useBy !== undefined && isOverdue(row.useBy, now)
                  ? "text-red-600"
                  : "text-amber-700"
              }
            >
              ({row.useBy === undefined ? "" : formatUseBy(row.useBy, now)})
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-4">
        {loading && <p className="text-sm text-muted">Looking for recipes…</p>}
        {!loading && recipes !== undefined && recipes.length > 0 && (
          <>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Cook these</h3>
            <ul aria-label="Recipes that use these" className="mt-1 flex flex-col gap-1">
              {recipes.map((recipe) => (
                <li key={recipe.id} className="text-sm">
                  <Link to="/recipes" className="font-medium text-primary hover:underline">
                    {recipe.title}
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
        {/* A failed lookup is reported the same way as an empty one: the card is
            a prompt, and an error banner on a nudge is noise the user can't act
            on. The items list above is still useful on its own. */}
        {!loading && (recipes === undefined || recipes.length === 0) && (
          <p className="text-sm text-muted">
            No recipe in your collection uses these yet —{" "}
            <Link to="/recipes/catalog" className="text-primary hover:underline">
              browse the catalog
            </Link>
            .
          </p>
        )}
      </div>

      <p className="mt-3 text-xs text-muted">
        Dates are estimates from typical shelf life, not printed labels.
      </p>
    </section>
  );
}
