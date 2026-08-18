import { api } from "@pantry/convex/api";
import { FIT_LABELS, formatDuration, humanizeSlug, missingLabel } from "@pantry/core";
import { useCatalog } from "@pantry/core/data";
import { TEST_IDS } from "@pantry/core/testing";
import { Link } from "@tanstack/react-router";
import { FIT_BADGE_CLASS } from "../lib/equipmentFit";
import { useTracedAction } from "../telemetry/useTracedAction";
import { CatalogFilters } from "./CatalogFilters";
import { ErrorText } from "./ErrorText";
import { RecipeDetails } from "./RecipeDetails";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { Input } from "./ui/Input";

/**
 * The seeded catalog (BL-0020): presentation over `useCatalog()`.
 *
 * The catalog request, the equipment fits, the filter selection and clone-on-add
 * live in `@pantry/core/data`, so the native catalog narrows to exactly the same
 * recipes rather than re-deriving the rules. What is web-specific and stays here
 * is the chip row, the badge colours, and the link into My Kitchen.
 */
export function Catalog() {
  const {
    shown,
    recipes,
    loading,
    loadError,
    error,
    reload,
    filter,
    setQuery,
    toggleCookTime,
    toggleDiet,
    toggleCuisine,
    clearFilter,
    filterActive,
    cuisines,
    diets,
    fits,
    equipment,
    canFilter,
    onlyMakeable,
    setOnlyMakeable,
    hidden,
    added,
    add,
  } = useCatalog({
    listCatalog: useTracedAction(api.recipes.listCatalog, "recipes.listCatalog"),
    makeability: useTracedAction(api.equipment.makeability, "equipment.makeability"),
    // Adding a catalog recipe CLONES it into the user's own recipes and baskets
    // the clone (BL-0020). It is deliberately not basket.add on the catalog id:
    // that row belongs to the sentinel "catalog" user, so the recipe on the plan
    // could never be edited, and it would break if the entry were retired.
    addFromCatalog: useTracedAction(api.recipes.addFromCatalog, "recipes.addFromCatalog"),
    listEquipment: useTracedAction(api.recipes.listEquipment, "recipes.listEquipment"),
  });

  return (
    <Card title="Catalog">
      {loading && recipes.length === 0 && <p className="text-sm text-muted">Loading catalog…</p>}
      {loadError && (
        <div className="flex items-center gap-2">
          <ErrorText message={loadError} />
          <Button variant="secondary" size="sm" onClick={reload}>
            Retry
          </Button>
        </div>
      )}
      {!loading && !loadError && recipes.length === 0 && (
        <p className="text-sm text-muted">No catalog recipes yet.</p>
      )}

      {recipes.length > 0 && (
        <>
          <Input
            type="search"
            placeholder="Search recipes, ingredients or tags…"
            className="mb-3 w-full"
            data-testid={TEST_IDS.recipes.catalogSearch}
            value={filter.query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search catalog"
          />
          <CatalogFilters
            filter={filter}
            cuisines={cuisines}
            diets={diets}
            onToggleCookTime={toggleCookTime}
            onToggleDiet={toggleDiet}
            onToggleCuisine={toggleCuisine}
          />
        </>
      )}

      {canFilter && (
        <div className="mb-2 flex flex-col gap-1">
          <label className="flex items-center gap-2 text-sm text-text">
            <input
              type="checkbox"
              checked={onlyMakeable}
              data-testid={TEST_IDS.recipes.onlyMakeable}
              onChange={(e) => setOnlyMakeable(e.target.checked)}
              className="h-4 w-4 accent-[var(--color-primary)]"
            />
            Only show recipes I can make
          </label>
          {/* Named, not silently dropped. "Unknown" recipes are hidden by this
              filter because we cannot vouch for them — but the user is told how
              many, so missing data never masquerades as a short catalog. */}
          {onlyMakeable && hidden && <p className="text-xs text-muted">{hidden}</p>}
        </div>
      )}
      {recipes.length > 0 && !canFilter && (
        <p className="mb-2 text-xs text-muted">
          Tell us what's in{" "}
          <Link to="/recipes/kitchen" className="text-primary underline">
            your kitchen
          </Link>{" "}
          and we'll flag the recipes you can make.
        </p>
      )}

      {/* The equipment filter has its own, more specific empty state below. */}
      {recipes.length > 0 && shown.length === 0 && !(canFilter && onlyMakeable) && (
        <div className="flex items-center gap-2">
          <p className="text-sm text-muted">No recipes match these filters.</p>
          {filterActive && (
            <Button
              variant="ghost"
              size="sm"
              data-testid={TEST_IDS.recipes.clearFilters}
              onClick={clearFilter}
            >
              Clear filters
            </Button>
          )}
        </div>
      )}

      <ul className="flex flex-col divide-y divide-border">
        {shown.map((r) => {
          const fit = fits[r.id];
          const badge = fit ? FIT_LABELS[fit.status] : null;
          return (
            <li
              key={r.id}
              data-testid={TEST_IDS.recipes.catalogItem(r.title)}
              className="flex flex-col gap-1.5 py-2"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="font-medium text-text">{r.title}</span>
                  {r.totalMinutes !== undefined && (
                    <span className="text-xs text-muted">{formatDuration(r.totalMinutes)}</span>
                  )}
                  {r.cuisine && (
                    <span className="text-xs text-muted">{humanizeSlug(r.cuisine)}</span>
                  )}
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  data-testid={TEST_IDS.recipes.catalogAdd(r.title)}
                  disabled={added.includes(r.id)}
                  onClick={() => void add(r)}
                >
                  {added.includes(r.id) ? "Added" : "Add to basket"}
                </Button>
              </div>
              {badge && fit && (
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    title={badge.description}
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${FIT_BADGE_CLASS[fit.status]}`}
                  >
                    {badge.label}
                  </span>
                  {fit.status === "blocked" && fit.missing.length > 0 && (
                    <span className="text-xs text-muted">
                      Needs {missingLabel(equipment, fit.missing)}
                    </span>
                  )}
                </div>
              )}
              {(r.tags ?? []).length > 0 && (
                <ul className="flex flex-wrap gap-1.5">
                  {(r.tags ?? []).map((tag) => (
                    <li key={tag} className="rounded-full bg-border px-2 py-0.5 text-xs text-muted">
                      {humanizeSlug(tag)}
                    </li>
                  ))}
                </ul>
              )}
              <RecipeDetails recipe={r} catalog={equipment} />
            </li>
          );
        })}
      </ul>
      {canFilter && onlyMakeable && shown.length === 0 && recipes.length > 0 && (
        <p className="text-sm text-muted">Nothing here matches your kitchen yet. {hidden}</p>
      )}
      <ErrorText message={error} />
    </Card>
  );
}
