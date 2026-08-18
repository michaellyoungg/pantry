import { api } from "@pantry/convex/api";
import type { AvoidResolution, AvoidResolutionKind } from "@pantry/types";
import { useAction, useMutation, useQuery } from "convex/react";
import { useCallback, useState } from "react";
import { useAsyncAction } from "../react/useAsyncAction";

// The single source of truth for diet seeds. Selecting a diet PRE-FILLS the
// avoid list so the user can see and edit exactly what gets excluded.
//
// This is deliberate: filtering by INFERRING which ingredients are meat would
// produce false negatives under partial dictionary coverage — a beef recipe
// shown to someone who declared vegetarian — which destroys trust in the whole
// feature. Nothing is ever excluded invisibly.
//
// It lives here and nowhere else: Convex stores what it is handed and never
// consults this table.
//
// Every entry below MUST be a real canonical item key from
// apps/recipe-service/internal/recipe/normalization.json.
// `useAvoidList.dietSeeds.test.ts` asserts every entry here still exists in
// that file, so the two cannot drift without a failing test. Seeds go through
// the same resolver as free-typed entries (BL-0052), which would now catch a
// drifted key and report it as unmatched — but a seed list that has to be
// reported is already a bug, so the test stays the primary guard.
const MEAT = [
  "chicken",
  "chicken breast",
  "chicken thigh",
  "ground beef",
  "ground turkey",
  "ground pork",
  "ground lamb",
  "steak",
  "pork chop",
  "pork tenderloin",
  "bacon",
  "sausage",
  "ham",
  "prosciutto",
];
const SEAFOOD = ["salmon", "shrimp", "cod", "tilapia"];
const ANIMAL_PRODUCTS = [
  "milk",
  "butter",
  "egg",
  "heavy cream",
  "half and half",
  "buttermilk",
  "sour cream",
  "yogurt",
  "greek yogurt",
  "cream cheese",
  "cottage cheese",
  "cheddar cheese",
  "parmesan",
  "mozzarella",
  "feta",
  "ricotta",
  "honey",
];

export const DIET_SEEDS: Record<string, string[]> = {
  vegetarian: [...MEAT, ...SEAFOOD],
  vegan: [...MEAT, ...SEAFOOD, ...ANIMAL_PRODUCTS],
  pescatarian: [...MEAT],
};

/** One stored avoid entry, with whatever the dictionary knows about it. */
export type AvoidEntry = {
  /** The key it is stored under, and the argument `remove` takes. */
  canonicalItem: string;
  /** What to show. The stored key when nothing resolved it. */
  display: string;
  kind: AvoidResolutionKind;
  /** Everything an allergen family covers. Empty for the other kinds. */
  members: string[];
};

export type UseAvoidList = {
  /** The stored list, resolved. Empty until the query lands. */
  entries: AvoidEntry[];
  /**
   * What the last add did, narrowed to the entries worth saying something
   * about — see `notable` below. Cleared by the next add or removal.
   */
  notes: AvoidResolution[];
  /** The diets `applyDiet` accepts, in the order to offer them. */
  diets: string[];
  /**
   * True until the stored list is known. Nothing that writes may run while it
   * is: a control acting on the empty fallback would act on the wrong list.
   */
  loading: boolean;
  error: string | null;
  /** Resolve entries against the dictionary and store what comes back. */
  add: (entries: string[]) => void;
  /** Pre-fill from a diet. Seeds resolve by the same path as typed entries. */
  applyDiet: (diet: string) => void;
  remove: (canonicalItem: string) => void;
};

/**
 * Is this resolution worth reporting back to the user?
 *
 * The silent case is the bug: an entry that matched nothing used to look
 * exactly like one that matched, and for an allergen that is the failure that
 * matters. So an add reports what matched nothing, what a family covers, and
 * what the dictionary renamed.
 *
 * An entry that resolved to exactly what was typed says nothing — its chip
 * appearing is the whole story, and a note per entry would bury the ones that
 * matter under thirty lines the moment a diet seed list is applied.
 */
function notable(r: AvoidResolution): boolean {
  return (
    r.kind !== "item" ||
    (r.families ?? []).length > 0 ||
    r.display.toLowerCase() !== r.input.toLowerCase()
  );
}

/**
 * The avoid list, headless (BL-0005, BL-0052, BL-0066).
 *
 * Avoiding an ingredient REMOVES recipes rather than ranking them lower, which
 * is why entries are canonicalized before they are stored and why the hook
 * hands back what each one resolved to. A client that showed a chip without
 * that report would be telling a cook with an allergy that it is handled when
 * nothing would ever match it.
 *
 * Adding is an ACTION, not a mutation: resolution needs the ingredient
 * dictionary in recipe-service, and a Convex mutation cannot make that call.
 * Removing is a plain mutation, so an entry can still be taken off the list
 * while that service is down.
 */
export function useAvoidList(): UseAvoidList {
  const prefs = useQuery(api.preferences.get);
  const addAvoidItems = useAction(api.preferences.addAvoidItems);
  const removeAvoidItem = useMutation(api.preferences.removeAvoidItem);
  const { run, error } = useAsyncAction();
  const [notes, setNotes] = useState<AvoidResolution[]>([]);

  const stored = prefs?.avoidItems ?? [];
  const byItem = new Map((prefs?.avoidResolutions ?? []).map((r) => [r.canonicalItem, r]));
  // An entry stored before BL-0052 has no resolution. It renders as its stored
  // key and as an ordinary item: the app does not know it matched nothing, and
  // saying so would be a guess dressed up as a warning.
  const entries: AvoidEntry[] = stored.map((canonicalItem) => {
    const resolution = byItem.get(canonicalItem);
    return {
      canonicalItem,
      display: resolution?.display ?? canonicalItem,
      kind: resolution?.kind ?? "item",
      members: resolution?.members ?? [],
    };
  });

  const add = useCallback(
    (entries: string[]) => {
      // `run` swallows a failure into `error` and resolves undefined; the notes
      // are cleared with it, because leaving the previous ones up beside a
      // failure would read as if the add had worked.
      void run(() => addAvoidItems({ entries })).then((resolved) =>
        setNotes((resolved ?? []).filter(notable)),
      );
    },
    [addAvoidItems, run],
  );

  const applyDiet = useCallback((diet: string) => add(DIET_SEEDS[diet] ?? []), [add]);

  const remove = useCallback(
    (canonicalItem: string) => {
      setNotes([]);
      void run(() => removeAvoidItem({ canonicalItem }));
    },
    [removeAvoidItem, run],
  );

  return {
    entries,
    notes,
    diets: Object.keys(DIET_SEEDS),
    loading: prefs === undefined,
    error,
    add,
    applyDiet,
    remove,
  };
}
