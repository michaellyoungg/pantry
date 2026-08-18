import { api } from "@pantry/convex/api";
import type { EquipmentDef, EquipmentFit, Recipe } from "@pantry/types";
import { useAction } from "convex/react";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { useCallback, useMemo, useState } from "react";
import {
  applyCatalogFilter,
  type CatalogFilter,
  cuisinesIn,
  dietsIn,
  emptyCatalogFilter,
  isFilterActive,
  toggleFacet,
} from "../catalogFilter";
import { hiddenSummary, tallyFits } from "../equipmentFit";
import { defaultServingsMultiplier } from "../planner";
import { useAsyncAction } from "../react/useAsyncAction";
import { useAsyncData } from "../react/useAsyncData";
import { useHouseholdSize } from "./useHouseholdSize";

/** `recipes.listCatalog`. Injectable so web can pass its traced wrapper. */
export type ListCatalog = (
  args: FunctionArgs<typeof api.recipes.listCatalog>,
) => Promise<FunctionReturnType<typeof api.recipes.listCatalog>>;

/** `equipment.makeability`. Injectable for the same reason. */
export type Makeability = (
  args: FunctionArgs<typeof api.equipment.makeability>,
) => Promise<FunctionReturnType<typeof api.equipment.makeability>>;

/** `recipes.addFromCatalog`. Injectable for the same reason. */
export type AddFromCatalog = (
  args: FunctionArgs<typeof api.recipes.addFromCatalog>,
) => Promise<FunctionReturnType<typeof api.recipes.addFromCatalog>>;

/** `recipes.listEquipment`. Injectable for the same reason. */
export type ListEquipmentDefs = (
  args: FunctionArgs<typeof api.recipes.listEquipment>,
) => Promise<FunctionReturnType<typeof api.recipes.listEquipment>>;

export type UseCatalog = {
  /** Every seeded recipe, unfiltered. */
  recipes: Recipe[];
  /** What the current filter leaves on screen. */
  shown: Recipe[];
  loading: boolean;
  /** A failed catalog load, already stringified. */
  loadError: string | null;
  /** The most recent failed add, already stringified. */
  error: string | null;
  reload: () => void;
  filter: CatalogFilter;
  setQuery: (query: string) => void;
  toggleCookTime: (id: NonNullable<CatalogFilter["cookTime"]>) => void;
  toggleDiet: (diet: string) => void;
  toggleCuisine: (cuisine: string) => void;
  clearFilter: () => void;
  /** True once any chip or the search box is in use — gates "Clear filters". */
  filterActive: boolean;
  /** The chips worth offering, derived from the loaded catalog. */
  cuisines: string[];
  diets: string[];
  /** Equipment fit per catalog recipe; empty when the lookup failed. */
  fits: Record<string, EquipmentFit>;
  /** The equipment catalog, for naming what a blocked recipe is missing. */
  equipment: EquipmentDef[];
  /**
   * Whether the equipment filter is worth offering. Without fits every recipe
   * is "unknown", and a filter that hides everything is worse than no filter.
   */
  canFilter: boolean;
  onlyMakeable: boolean;
  setOnlyMakeable: (only: boolean) => void;
  /** What the filters are hiding, in words, or null when nothing is. */
  hidden: string | null;
  /** Catalog ids added this session, so a button can say "Added". */
  added: string[];
  /** Clone the catalog recipe into the user's own and basket the clone. */
  add: (recipe: Recipe) => Promise<void>;
};

/**
 * The seeded catalog with its search, chips and equipment filter (BL-0020,
 * BL-0043), with no view attached.
 *
 * The filter *selection* lives here rather than in a view because "what does
 * vegan + under 30 min show?" is a question about the data, and the parity
 * plan's whole point is that two clients must not answer it differently. What
 * stays in each view is how a chip looks and how it is tapped.
 *
 * The three requests are deliberately independent: equipment being unavailable
 * costs the badges and the makeable filter, never the catalog itself.
 */
export function useCatalog({
  listCatalog,
  makeability,
  addFromCatalog,
  listEquipment,
}: {
  listCatalog?: ListCatalog;
  makeability?: Makeability;
  addFromCatalog?: AddFromCatalog;
  listEquipment?: ListEquipmentDefs;
} = {}): UseCatalog {
  const listCatalogAction = useAction(api.recipes.listCatalog);
  const makeabilityAction = useAction(api.equipment.makeability);
  const addFromCatalogAction = useAction(api.recipes.addFromCatalog);
  const listEquipmentAction = useAction(api.recipes.listEquipment);
  const fetchCatalog = listCatalog ?? listCatalogAction;
  const fetchFits = makeability ?? makeabilityAction;
  const clone = addFromCatalog ?? addFromCatalogAction;
  const fetchEquipment = listEquipment ?? listEquipmentAction;

  const householdSize = useHouseholdSize();
  const { run, error } = useAsyncAction();

  const load = useCallback(() => fetchCatalog({}), [fetchCatalog]);
  const { data, loading, error: loadError, reload } = useAsyncData(load);
  const loadFits = useCallback(() => fetchFits({}), [fetchFits]);
  const { data: fitData, error: fitError } = useAsyncData(loadFits);
  const loadEquipment = useCallback(() => fetchEquipment({}), [fetchEquipment]);
  const { data: equipmentData } = useAsyncData(loadEquipment);

  const [filter, setFilter] = useState<CatalogFilter>(emptyCatalogFilter);
  const [onlyMakeable, setOnlyMakeable] = useState(false);
  const [added, setAdded] = useState<string[]>([]);

  const recipes = useMemo(() => data ?? [], [data]);
  const fits: Record<string, EquipmentFit> = useMemo(() => fitData?.fits ?? {}, [fitData]);
  const canFilter = fitError === null && Object.keys(fits).length > 0;

  // The discovery filters and the equipment filter answer independent questions
  // ("what fits tonight?" vs "what can this kitchen make?"), so both narrow.
  const shown = useMemo(() => {
    const matching = applyCatalogFilter(recipes, filter);
    return canFilter && onlyMakeable
      ? matching.filter((r) => fits[r.id]?.status === "makeable")
      : matching;
  }, [recipes, filter, canFilter, onlyMakeable, fits]);

  // Tallied over the catalog on screen, not the server's library-wide counts.
  const hidden = useMemo(() => {
    const shownIds = new Set(shown.map((r) => r.id));
    return hiddenSummary(
      tallyFits(
        recipes.filter((r) => !shownIds.has(r.id)).map((r) => r.id),
        fits,
      ),
    );
  }, [recipes, shown, fits]);

  const add = useCallback(
    async (recipe: Recipe) => {
      const cloned = await run(() =>
        clone({
          catalogRecipeId: recipe.id,
          // The clone inherits the catalog recipe's yield, so the household
          // default (BL-0018) comes out the same either way.
          servingsMultiplier: defaultServingsMultiplier(householdSize, recipe.servings),
        }),
      );
      // The clone lands in the user's own recipes, which are loaded separately;
      // there is nothing to invalidate here.
      if (cloned) setAdded((prev) => (prev.includes(recipe.id) ? prev : [...prev, recipe.id]));
    },
    [run, clone, householdSize],
  );

  return {
    recipes,
    shown,
    loading,
    loadError,
    error,
    reload,
    filter,
    setQuery: useCallback((query: string) => setFilter((f) => ({ ...f, query })), []),
    toggleCookTime: useCallback(
      (id: NonNullable<CatalogFilter["cookTime"]>) =>
        setFilter((f) => ({ ...f, cookTime: f.cookTime === id ? undefined : id })),
      [],
    ),
    toggleDiet: useCallback(
      (diet: string) => setFilter((f) => ({ ...f, diets: toggleFacet(f.diets, diet) })),
      [],
    ),
    toggleCuisine: useCallback(
      (cuisine: string) => setFilter((f) => ({ ...f, cuisines: toggleFacet(f.cuisines, cuisine) })),
      [],
    ),
    clearFilter: useCallback(() => setFilter(emptyCatalogFilter), []),
    filterActive: isFilterActive(filter),
    cuisines: useMemo(() => cuisinesIn(recipes), [recipes]),
    diets: useMemo(() => dietsIn(recipes), [recipes]),
    fits,
    equipment: useMemo(() => equipmentData ?? [], [equipmentData]),
    canFilter,
    onlyMakeable,
    setOnlyMakeable,
    hidden,
    added,
    add,
  };
}
