import { api } from "@pantry/convex/api";
import type { GeneratedRecipeDraft, Recommendation } from "@pantry/types";
import { useAction, useMutation, useQuery } from "convex/react";
import { useCallback } from "react";
import { expiringSoon, type PantryRow } from "../expiry";
import { useAsyncAction } from "../react/useAsyncAction";
import { useAsyncData } from "../react/useAsyncData";

/**
 * Where the card is rendered, which changes what it is *for*.
 *
 * On Home it is an INTERRUPT: it appears only when there is genuinely food
 * about to be wasted, so it never competes with the weekly loop's single next
 * action. On the pantry screen it is the feature's home, so it shows even when
 * nothing is expiring and the user is simply browsing what they could cook.
 */
export type UseItUpVariant = "nudge" | "page";

export type UseUseItUp = {
  /**
   * Items inside the expiry horizon, soonest first.
   *
   * Derived from local Convex state, not from the ranker — which is why the
   * "use this soon" half of the card still renders when recommendations are
   * slow or down.
   */
  batch: PantryRow[];
  /** Ranked suggestions, or `undefined` before the first response. */
  suggestions: Recommendation[] | undefined;
  loading: boolean;
  /** A failed suggestion lookup. The batch above is still valid. */
  error: string | null;
  /** A failed "add to plan". Distinct from `error`: the card loaded fine. */
  addError: string | null;
  /** True when the card should render nothing at all. */
  silent: boolean;
  /** The clock the batch was filtered against, so views format against the same instant. */
  now: number;
  /** Put a suggestion on the plan, saving a generated one first. */
  addToPlan: (recommendation: Recommendation) => void;
};

/**
 * The ONE "use it up" surface's wiring (BL-0050), headless (BL-0055).
 *
 * /pantry used to render two cards that both suggested recipes to use things
 * up, built independently and merged without ever having been designed
 * together — and the expiry one called an endpoint that applied no preference
 * filtering, so it could recommend a recipe containing an avoided ingredient a
 * few hundred pixels below a card filtering that exact ingredient out. Both
 * now route through `recommendations.pantry`, where the avoid list is a hard
 * pre-filter.
 *
 * This hook exists so porting the card to a second client (BL-0059) does not
 * quietly recreate that history in a new form: two platforms each wiring the
 * same action, each with their own refetch key and their own idea of what
 * "expiring" means. The card is one surface here, and two renderings above it.
 *
 * The card expresses TWO different signals and the return value keeps them
 * apart: `batch` is a fact about the fridge with a deadline, `suggestions` is a
 * prediction about taste. Urgency arrives on a suggestion as a structured
 * field rather than as another reason string, so telling them apart in a view
 * is a property check, not a prefix match on English.
 */
export function useUseItUp(variant: UseItUpVariant = "nudge"): UseUseItUp {
  const rows = (useQuery(api.pantry.list) ?? []) as PantryRow[];
  const recommend = useAction(api.recommendations.pantry);
  const acceptGenerated = useAction(api.recommendations.acceptGenerated);
  const addToBasket = useMutation(api.basket.add);

  const now = Date.now();
  const batch = expiringSoon(rows, now);

  // The nudge gate also means the common case — nothing expiring — costs no
  // request at all.
  const silent = variant === "nudge" && batch.length === 0;

  // Suggestions refetch when the pantry changes rather than waiting for a
  // button press. A card that only appears when something is about to spoil and
  // THEN asks you to tap before it says what to do about it is the "alert with
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

  // Generated suggestions carry their full text in a sidecar keyed by the same
  // synthetic id, because a `gen-` id names no stored recipe — there is nothing
  // to fetch it back with later.
  const drafts = new Map((data?.generated ?? []).map((d) => [d.recipeId, d]));
  const { run, error: addError } = useAsyncAction();

  /**
   * Put a suggestion on the plan.
   *
   * A generated one has to become a real recipe first: the plan holds recipe
   * ids, and a `gen-` id resolves to nothing. Saving on accept is also the only
   * time anything generated is stored — suggestions nobody takes are never
   * written anywhere.
   */
  // Not memoized, and it should not be: `drafts` is rebuilt every render, so a
  // useCallback over it would churn its identity anyway while implying it does
  // not. Nothing downstream keys on this function's identity.
  const addToPlan = (recommendation: Recommendation): void => {
    const draft = drafts.get(recommendation.recipeId);
    void run(async () => {
      if (draft === undefined) {
        await addToBasket({
          recipeId: recommendation.recipeId,
          title: recommendation.title,
        });
        return;
      }
      const saved = await acceptGenerated({
        title: draft.title,
        servings: draft.servings,
        ingredients: draft.ingredients,
        steps: draft.steps,
      });
      await addToBasket({ recipeId: saved.id, title: saved.title });
    });
  };

  return {
    batch,
    suggestions: data?.results,
    loading,
    error,
    addError,
    silent,
    now,
    addToPlan,
  };
}
