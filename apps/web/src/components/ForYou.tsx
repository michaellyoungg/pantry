import { api } from "@pantry/convex/api";
import { useAsyncData } from "@pantry/core/react";
import type { Recommendation } from "@pantry/types";
import { Link } from "@tanstack/react-router";
import { useAction, useMutation } from "convex/react";
import { useCallback, useEffect, useState } from "react";
import { ErrorText } from "./ErrorText";
import { Button } from "./ui/Button";

/**
 * "For you" — the discovery surface (BL-0005 increment 2).
 *
 * The sibling of `UseItUp`, and deliberately a different question. That card
 * asks "what can I cook with what is in the fridge"; this one asks "what should
 * I try". They rank through separate endpoints because the intents pull in
 * opposite directions — one rewards the familiar, the other the unfamiliar — and
 * they read differently on screen for the same reason: there is no urgency line
 * here, because nothing on this card is about a deadline.
 *
 * Every interaction with it is RECORDED, and that log is the only thing the
 * recommender ever learns from:
 *
 *  - the batch is logged as `shown` once it renders (deduplicated per recipe per
 *    day server-side, so a re-render is not a new impression);
 *  - "Add to plan" is `accepted`;
 *  - "Not for me" is `dismissed`, and removes the recipe from this surface until
 *    the event ages out of the recency window — the user answered the question,
 *    and re-asking tomorrow is not respecting the answer.
 *
 * The recipe's canonical ingredients travel WITH each event, taken from `have`
 * and `missing`, because that is what the affinity fold is keyed on and a Convex
 * mutation cannot fetch them. They are already on screen; sending them costs a
 * field, and not sending them would cost a round trip per click.
 */

/** The canonical ingredients of a recommendation, as the event log records them. */
function canonicalItemsOf(r: Recommendation): string[] {
  return [...r.have, ...(r.missing ?? []).map((m) => m.canonicalItem)];
}

export function ForYou() {
  const discover = useAction(api.recommendations.discover);
  const recordEvent = useMutation(api.recommendationEvents.record);
  const recordShown = useMutation(api.recommendationEvents.recordShownBatch);
  const addToBasket = useMutation(api.basket.add);

  // Dismissals hide their row immediately. The server has already been told, but
  // this list is fetched rather than reactive, so without local state the card
  // would keep showing something the user just rejected until the next load.
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [addError, setAddError] = useState<string | null>(null);

  const load = useCallback(() => discover({}), [discover]);
  const { data, loading, error } = useAsyncData(load);
  const results = data ?? [];

  // Log the batch once it has actually rendered — an impression is a claim that
  // the user could see it. Keyed on the ids so a re-render with the same results
  // does not re-fire; the mutation deduplicates again server-side, because a
  // remount is not something the client can be trusted to notice.
  const shownKey = results.map((r) => r.recipeId).join(",");
  useEffect(() => {
    if (results.length === 0) return;
    void recordShown({
      context: "discover",
      recipes: results.map((r) => ({
        recipeId: r.recipeId,
        canonicalItems: canonicalItemsOf(r),
      })),
    }).catch(() => {
      // Losing an impression costs a little novelty accuracy and nothing else.
      // It must never surface as an error on a card the user did not ask for.
    });
    // biome-ignore lint/correctness/useExhaustiveDependencies: `results` is a fresh array each render; `shownKey` compares it by value
  }, [shownKey, recordShown]);

  const visible = results.filter((r) => !dismissed.includes(r.recipeId));

  const add = async (r: Recommendation) => {
    setAddError(null);
    try {
      await addToBasket({ recipeId: r.recipeId, title: r.title });
      await recordEvent({
        recipeId: r.recipeId,
        context: "discover",
        action: "accepted",
        canonicalItems: canonicalItemsOf(r),
      });
    } catch {
      setAddError("Couldn't add that to the plan.");
    }
  };

  const dismiss = async (r: Recommendation) => {
    // Hidden first: the user's answer should land instantly, and a failed write
    // costs a suggestion reappearing next week rather than a broken card.
    setDismissed((ids) => [...ids, r.recipeId]);
    await recordEvent({
      recipeId: r.recipeId,
      context: "discover",
      action: "dismissed",
      canonicalItems: canonicalItemsOf(r),
    }).catch(() => undefined);
  };

  return (
    <section
      aria-label="For you"
      className="rounded-xl border border-border bg-surface p-5 shadow-sm"
    >
      <h2 className="text-lg font-semibold text-text">For you</h2>
      <p className="mt-1 text-sm text-muted">
        Ideas to try, ranked by what you cook. The more you add and dismiss, the better this gets.
      </p>

      <div className="mt-4">
        {loading && <p className="text-sm text-muted">Looking for ideas…</p>}

        {!loading && visible.length > 0 && (
          <ul aria-label="Suggested recipes" className="flex flex-col divide-y divide-border">
            {visible.map((r) => (
              <li key={r.recipeId} className="flex items-start justify-between gap-2 py-3">
                <div className="min-w-0">
                  <Link
                    to="/recipes"
                    search={{ recipe: r.recipeId }}
                    className="font-medium text-primary hover:underline"
                    aria-label={r.title}
                  >
                    {r.title}
                  </Link>
                  {r.reasons.length > 0 && (
                    <p className="text-xs text-muted">{r.reasons.slice(0, 3).join(" · ")}</p>
                  )}
                  {/* Defence in depth: the type says this is never null, but a
                      nil Go slice serializes that way and has crashed the app
                      before. Degrade to no line rather than throwing. */}
                  {(r.missing?.length ?? 0) > 0 && (
                    <p className="text-xs text-muted">
                      Need: {r.missing.map((m) => m.display).join(", ")}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    aria-label={`Add ${r.title} to plan`}
                    onClick={() => {
                      void add(r);
                    }}
                  >
                    Add to plan
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Not for me: ${r.title}`}
                    onClick={() => {
                      void dismiss(r);
                    }}
                  >
                    Not for me
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {/* Empty is a first-class state and says what to do about it. With six
            recipes in the catalog, "nothing new" is a normal Tuesday rather than
            a failure, and the answer is more corpus — not more ranking. */}
        {!loading && error === null && visible.length === 0 && (
          <p className="text-sm text-muted">
            Nothing new to suggest right now —{" "}
            <Link to="/recipes/catalog" className="text-primary hover:underline">
              browse the catalog
            </Link>{" "}
            or import a recipe you like.
          </p>
        )}

        {/* Suggestions are additive and must never break the page. */}
        {!loading && error !== null && <ErrorText message="Couldn't load suggestions just now." />}
        {addError !== null && <ErrorText message={addError} />}
      </div>
    </section>
  );
}
