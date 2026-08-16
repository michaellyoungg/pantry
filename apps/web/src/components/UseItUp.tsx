import { api } from "@pantry/convex/api";
import { expiringSoon, formatUseBy, isOverdue, type PantryRow } from "@pantry/core";
import { useAsyncData } from "@pantry/core/react";
import type { GeneratedRecipeDraft, Recommendation } from "@pantry/types";
import { Link } from "@tanstack/react-router";
import { useAction, useMutation, useQuery } from "convex/react";
import { useCallback } from "react";
import { ErrorText } from "./ErrorText";
import { Button } from "./ui/Button";

/**
 * The ONE "use it up" surface (BL-0050).
 *
 * /pantry used to render two cards that both suggested recipes to use things
 * up, built independently and merged without ever having been designed
 * together. Worse than the duplication: the expiry one called an endpoint that
 * applied no preference filtering, so it could recommend a recipe containing an
 * avoided ingredient a few hundred pixels below a card that was filtering that
 * exact ingredient out. Both now route through `recommendations.pantry`, where
 * the avoid list is a hard pre-filter.
 *
 * The card expresses TWO different signals and deliberately keeps them apart:
 *
 *  - **"Use this soon"** — a fact about the fridge with a deadline. It appears
 *    as the amber items strip and, per recipe, as the amber urgency line. This
 *    half needs no network call: it is derived from local Convex state, so it
 *    still renders when the ranker is slow or down.
 *  - **"You'd like this"** — a prediction about taste, rendered muted beneath.
 *
 * Urgency arrives as a structured field rather than as another reason string,
 * so telling the two apart is a property check, not a prefix match on English.
 *
 * A third kind of row can appear here: a GENERATED suggestion (BL-0034), which
 * the server adds only when the corpus came up thin. It is an idea a model
 * invented, not a curated and tested recipe, so it is labelled as such — and it
 * exists nowhere until the user accepts it, which is why adding one saves it
 * first and only then puts the real recipe on the plan.
 */

type Variant = "nudge" | "page";

export function UseItUp({ variant = "nudge" }: { variant?: Variant }) {
  const rows = (useQuery(api.pantry.list) ?? []) as PantryRow[];
  const recommend = useAction(api.recommendations.pantry);
  const acceptGenerated = useAction(api.recommendations.acceptGenerated);
  const addToBasket = useMutation(api.basket.add);

  const now = Date.now();
  const batch = expiringSoon(rows, now);

  // On Home the card is an INTERRUPT: it appears only when there is genuinely
  // food about to be wasted, so it never competes with the weekly loop's single
  // next action. That gate also means the common case — nothing expiring —
  // costs no request at all.
  const silent = variant === "nudge" && batch.length === 0;

  // Suggestions refetch when the pantry changes rather than waiting for a button
  // press. A card that only appears when something is about to spoil and THEN
  // asks you to click before it says what to do about it is the "alert with
  // nothing to do about it" the expiry design exists to avoid.
  //
  // The pantry is carried through the dependency list as a serialized string:
  // the rows are a fresh reference every render, which would re-request
  // forever, and a string compares by value.
  // `useItUp` MUST be in the key: it is the strongest signal the ranker reads,
  // so marking an item to use up has to re-ask. Leaving it out looks like the
  // flag doing nothing.
  const pantryKey = JSON.stringify(
    rows.map((r) => `${r.canonicalItem}:${r.state}:${r.useBy ?? ""}:${r.useItUp ?? false}`),
  );
  const load = useCallback(() => {
    // Referenced so the fetch re-runs when the pantry changes; the action reads
    // the pantry itself, server-side, so nothing needs to be passed.
    void pantryKey;
    return silent
      ? Promise.resolve<{ results: Recommendation[]; generated: GeneratedRecipeDraft[] }>({
          results: [],
          generated: [],
        })
      : recommend({});
  }, [pantryKey, recommend, silent]);
  const { data, loading, error } = useAsyncData(load);
  const recipes = data?.results;

  // Generated suggestions carry their full text in a sidecar keyed by the same
  // synthetic id, because a `gen-` id names no stored recipe — there is nothing
  // to fetch it back with later.
  const drafts = new Map((data?.generated ?? []).map((d) => [d.recipeId, d]));

  /**
   * Put a suggestion on the plan.
   *
   * A generated one has to become a real recipe first: the plan holds recipe
   * ids, and a `gen-` id resolves to nothing. Saving on accept is also the only
   * time anything generated is stored — suggestions nobody takes are never
   * written anywhere.
   */
  const addRecipe = async (r: Recommendation) => {
    const draft = drafts.get(r.recipeId);
    if (draft === undefined) {
      await addToBasket({ recipeId: r.recipeId, title: r.title });
      return;
    }
    const saved = await acceptGenerated({
      title: draft.title,
      servings: draft.servings,
      ingredients: draft.ingredients,
      steps: draft.steps,
    });
    await addToBasket({ recipeId: saved.id, title: saved.title });
  };

  if (silent) return null;

  return (
    <section
      aria-label="Use it up"
      className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-5 shadow-sm"
    >
      <h2 className="text-lg font-semibold text-text">
        {batch.length === 0
          ? "Use it up"
          : batch.length === 1
            ? "1 item to use this week"
            : `${batch.length} items to use this week`}
      </h2>

      {batch.length > 0 && (
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
      )}

      {batch.length === 0 && (
        <p className="mt-1 text-sm text-muted">
          Nothing is about to go off. Here's what you could cook from what you have — mark items
          below to use up and they'll be prioritized.
        </p>
      )}

      <div className="mt-4">
        {loading && <p className="text-sm text-muted">Looking for recipes…</p>}

        {!loading && recipes !== undefined && recipes.length > 0 && (
          <>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Cook these</h3>
            <ul
              aria-label="Recipes that use these"
              className="mt-1 flex flex-col divide-y divide-border"
            >
              {recipes.map((r) => (
                <li key={r.recipeId} className="flex items-start justify-between gap-2 py-2">
                  <div className="min-w-0">
                    {/* A generated idea has no recipe page to link to — it does
                        not exist yet — so it renders as plain text with the
                        badge instead of as a link that would 404. */}
                    {r.source === "generated" ? (
                      <p className="flex flex-wrap items-center gap-2 font-medium text-text">
                        {r.title}
                        <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
                          AI idea
                        </span>
                      </p>
                    ) : (
                      <Link
                        to="/recipes"
                        className="font-medium text-primary hover:underline"
                        aria-label={r.title}
                      >
                        {r.title}
                      </Link>
                    )}

                    {/* Said plainly, not just as a badge: this is the one row on
                        the card that nobody has cooked or checked. */}
                    {r.source === "generated" && (
                      <p className="text-xs text-muted">
                        Suggested by AI from your pantry — not a tested recipe. Check it before you
                        cook.
                      </p>
                    )}

                    {/* Urgency reads as its own amber line, never mixed into the
                        muted fit reasons below: "this spoils in two days" is a
                        deadline, and "uses 4 things you have" is a preference. */}
                    {r.urgency !== undefined && (
                      <p
                        className={`text-xs font-medium ${
                          isOverdue(r.urgency.useBy, now) ? "text-red-600" : "text-amber-700"
                        }`}
                      >
                        Use soon — {r.urgency.display} ({formatUseBy(r.urgency.useBy, now)})
                      </p>
                    )}

                    {r.reasons.length > 0 && (
                      <p className="text-xs text-muted">{r.reasons.slice(0, 3).join(" · ")}</p>
                    )}

                    {/* Defence in depth: a producer bug can serialize `missing`
                        as null (a nil Go slice encodes that way) even though the
                        type says it never can. Guard here so a bad payload
                        degrades to "no missing line" instead of crashing. */}
                    {(r.missing?.length ?? 0) > 0 && (
                      <p className="text-xs text-muted">
                        Need: {r.missing.map((m) => m.display).join(", ")}
                      </p>
                    )}
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    aria-label={`Add ${r.title} to plan`}
                    onClick={() => {
                      void addRecipe(r);
                    }}
                  >
                    {r.source === "generated" ? "Save & plan" : "Add to plan"}
                  </Button>
                </li>
              ))}
            </ul>
          </>
        )}

        {/* Empty is a first-class state, distinct from failure. The wording
            differs by variant because the question differs: on Home the user is
            looking at food about to spoil, on /pantry they are browsing. */}
        {!loading && error === null && recipes !== undefined && recipes.length === 0 && (
          <p className="text-sm text-muted">
            {batch.length > 0 ? (
              <>
                No recipe uses these yet —{" "}
                <Link to="/recipes/catalog" className="text-primary hover:underline">
                  browse the catalog
                </Link>
                .
              </>
            ) : (
              "Nothing close yet — mark a few more items you have."
            )}
          </p>
        )}

        {/* Recommendations are additive and must never break the page. A failed
            lookup collapses to this line; the items strip above came from local
            state and is still useful on its own. */}
        {!loading && error !== null && <ErrorText message="Couldn't load suggestions just now." />}
      </div>

      {batch.length > 0 && (
        <p className="mt-3 text-xs text-muted">
          Dates are estimates from typical shelf life, not printed labels.
        </p>
      )}
    </section>
  );
}
