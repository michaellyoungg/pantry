import { api } from "@pantry/convex/api";
import { useMutation, useQuery } from "convex/react";
import { useCallback } from "react";
import { COOK_TIME_BUCKETS, humanizeSlug, slugifyFacet } from "../discovery";
import { useAsyncAction } from "../react/useAsyncAction";

/** One stored cuisine: the slug a recipe carries, and what to show for it. */
export type TasteCuisine = { slug: string; label: string };

export type UseTastePreferences = {
  cuisines: TasteCuisine[];
  /**
   * The cook-time limit in minutes, or 0 for "no preference" — the wire value
   * `preferences.set` reads as an explicit clear rather than as a limit.
   */
  maxMinutes: number;
  /** The limits to offer, the same ones the catalog's time filter uses. */
  buckets: typeof COOK_TIME_BUCKETS;
  /**
   * True until the stored tastes are known. Nothing may be written while it is:
   * adding one cuisine against the empty fallback would submit a list that
   * silently drops every taste the user already had.
   */
  loading: boolean;
  error: string | null;
  addCuisine: (input: string) => void;
  removeCuisine: (slug: string) => void;
  setMaxMinutes: (minutes: number) => void;
};

/**
 * What the cook likes, as opposed to what they refuse (BL-0030), headless
 * (BL-0055).
 *
 * It sits beside the avoid list but is a different KIND of setting: an avoid
 * entry removes recipes, while a taste only reorders them. Conflating the two
 * is how a "preference" quietly becomes a filter and a cook stops being shown
 * food they would have enjoyed — so they are separate hooks over the same
 * document, and each client draws the contrast in its own copy.
 *
 * These are the inputs to the ranker's `cuisineMatch` and `timeFit`. Both
 * degrade to "no signal" when unset, so an empty list here leaves
 * recommendations exactly as they were before it existed.
 */
export function useTastePreferences(): UseTastePreferences {
  const prefs = useQuery(api.preferences.get);
  const save = useMutation(api.preferences.set);
  const { run, error } = useAsyncAction();

  const cuisines = (prefs?.cuisines ?? []).map((slug) => ({
    slug,
    label: humanizeSlug(slug),
  }));

  const addCuisine = useCallback(
    (input: string) => {
      if (prefs === undefined) return;
      // Slugified here, not on the way out, so the stored value is the same
      // string a recipe carries. An entry with no usable characters is not a
      // taste.
      const slug = slugifyFacet(input);
      if (slug === "") return;
      const current = prefs.cuisines ?? [];
      if (current.includes(slug)) return;
      void run(() => save({ cuisines: [...current, slug] }));
    },
    [prefs, run, save],
  );

  const removeCuisine = useCallback(
    (slug: string) => {
      if (prefs === undefined) return;
      void run(() => save({ cuisines: (prefs.cuisines ?? []).filter((c) => c !== slug) }));
    },
    [prefs, run, save],
  );

  const setMaxMinutes = useCallback(
    (minutes: number) => {
      if (prefs === undefined) return;
      void run(() => save({ maxMinutes: minutes }));
    },
    [prefs, run, save],
  );

  return {
    cuisines,
    maxMinutes: prefs?.maxMinutes ?? 0,
    buckets: COOK_TIME_BUCKETS,
    loading: prefs === undefined,
    error,
    addCuisine,
    removeCuisine,
    setMaxMinutes,
  };
}
