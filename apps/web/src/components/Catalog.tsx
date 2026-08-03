import { api } from "@pantry/convex/api";
import { useAsyncAction, useAsyncData } from "@pantry/core/react";
import { useCallback, useMemo, useState } from "react";
import { formatDuration, humanizeSlug } from "../lib/discovery";
import { useTracedAction } from "../telemetry/useTracedAction";
import {
  applyCatalogFilter,
  type CatalogFilter,
  CatalogFilters,
  emptyFilter,
  isFilterActive,
} from "./CatalogFilters";
import { ErrorText } from "./ErrorText";
import { RecipeDetails } from "./RecipeDetails";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { Input } from "./ui/Input";

export function Catalog() {
  const listCatalog = useTracedAction(api.recipes.listCatalog, "recipes.listCatalog");
  // Adding a catalog recipe CLONES it into the user's own recipes and baskets
  // the clone (BL-0020). It is deliberately not basket.add on the catalog id:
  // that row belongs to the sentinel "catalog" user, so the recipe on the plan
  // could never be edited, and it would break if the entry were retired.
  const addFromCatalog = useTracedAction(api.recipes.addFromCatalog, "recipes.addFromCatalog");
  // Convex actions require an args object; useTracedAction injects traceCtx into it.
  // Wrap in useCallback so useAsyncData's effect (keyed on fn) doesn't refire every render.
  const load = useCallback(() => listCatalog({}), [listCatalog]);
  const { data, loading, error: loadError, reload } = useAsyncData(load);
  const { run, error } = useAsyncAction();
  const [filter, setFilter] = useState<CatalogFilter>(emptyFilter);
  // Which catalog ids this session has already added, so the button can say so
  // rather than looking like it did nothing the second time.
  const [added, setAdded] = useState<string[]>([]);

  const recipes = useMemo(() => data ?? [], [data]);
  const visible = useMemo(() => applyCatalogFilter(recipes, filter), [recipes, filter]);

  async function add(recipeId: string) {
    const clone = await run(() => addFromCatalog({ catalogRecipeId: recipeId }));
    // The clone lands in the user's own recipes; /recipes loads fresh on
    // navigation, so there is nothing to invalidate here.
    if (clone) setAdded((prev) => (prev.includes(recipeId) ? prev : [...prev, recipeId]));
  }

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
            value={filter.query}
            onChange={(e) => setFilter({ ...filter, query: e.target.value })}
            aria-label="Search catalog"
          />
          <CatalogFilters recipes={recipes} filter={filter} onChange={setFilter} />
        </>
      )}

      {recipes.length > 0 && visible.length === 0 && (
        <div className="flex items-center gap-2">
          <p className="text-sm text-muted">No recipes match these filters.</p>
          {isFilterActive(filter) && (
            <Button variant="ghost" size="sm" onClick={() => setFilter(emptyFilter)}>
              Clear filters
            </Button>
          )}
        </div>
      )}

      <ul className="flex flex-col divide-y divide-border">
        {visible.map((r) => (
          <li key={r.id} className="flex flex-col gap-1.5 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="font-medium text-text">{r.title}</span>
                {r.totalMinutes !== undefined && (
                  <span className="text-xs text-muted">{formatDuration(r.totalMinutes)}</span>
                )}
                {r.cuisine && <span className="text-xs text-muted">{humanizeSlug(r.cuisine)}</span>}
              </span>
              <Button
                variant="secondary"
                size="sm"
                disabled={added.includes(r.id)}
                onClick={() => add(r.id)}
              >
                {added.includes(r.id) ? "Added" : "Add to basket"}
              </Button>
            </div>
            {(r.tags ?? []).length > 0 && (
              <ul className="flex flex-wrap gap-1.5">
                {(r.tags ?? []).map((tag) => (
                  <li key={tag} className="rounded-full bg-border px-2 py-0.5 text-xs text-muted">
                    {humanizeSlug(tag)}
                  </li>
                ))}
              </ul>
            )}
            <RecipeDetails recipe={r} />
          </li>
        ))}
      </ul>
      <ErrorText message={error} />
    </Card>
  );
}
