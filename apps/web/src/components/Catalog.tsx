import { api } from "@pantry/convex/api";
import { addToBasketOptimistic } from "@pantry/core/convex";
import { useAsyncAction, useAsyncData } from "@pantry/core/react";
import type { EquipmentFit } from "@pantry/types";
import { Link } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { useCallback, useState } from "react";
import { FIT_BADGES, hiddenSummary, missingLabel, tallyFits } from "../lib/equipmentFit";
import { useEquipmentCatalog } from "../lib/useEquipmentCatalog";
import { useTracedAction } from "../telemetry/useTracedAction";
import { ErrorText } from "./ErrorText";
import { RecipeDetails } from "./RecipeDetails";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";

export function Catalog() {
  const listCatalog = useTracedAction(api.recipes.listCatalog, "recipes.listCatalog");
  const makeability = useTracedAction(api.equipment.makeability, "equipment.makeability");
  const addToBasket = useMutation(api.basket.add).withOptimisticUpdate(addToBasketOptimistic);
  // Convex actions require an args object; useTracedAction injects traceCtx into it.
  // Wrap in useCallback so useAsyncData's effect (keyed on fn) doesn't refire every render.
  const load = useCallback(() => listCatalog({}), [listCatalog]);
  const { data, loading, error: loadError, reload } = useAsyncData(load);
  // Loaded separately from the recipes, so equipment being unavailable costs
  // the badges and the filter but never the catalog itself.
  const loadFits = useCallback(() => makeability({}), [makeability]);
  const { data: fitData, error: fitError } = useAsyncData(loadFits);
  const { catalog: equipment } = useEquipmentCatalog();
  const { run, error } = useAsyncAction();
  const [onlyMakeable, setOnlyMakeable] = useState(false);

  const recipes = data ?? [];
  const fits: Record<string, EquipmentFit> = fitData?.fits ?? {};
  // Only offered once we actually know something. Without fits every recipe is
  // "unknown", and a filter that hides everything is worse than no filter.
  const canFilter = fitError === null && Object.keys(fits).length > 0;
  const shown =
    canFilter && onlyMakeable ? recipes.filter((r) => fits[r.id]?.status === "makeable") : recipes;
  // Tallied over the catalog on screen, not the server's library-wide counts.
  const hidden = hiddenSummary(
    tallyFits(
      recipes.filter((r) => !shown.includes(r)).map((r) => r.id),
      fits,
    ),
  );

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

      {canFilter && (
        <div className="mb-2 flex flex-col gap-1">
          <label className="flex items-center gap-2 text-sm text-text">
            <input
              type="checkbox"
              checked={onlyMakeable}
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

      <ul className="flex flex-col divide-y divide-border">
        {shown.map((r) => {
          const fit = fits[r.id];
          const badge = fit ? FIT_BADGES[fit.status] : null;
          return (
            <li key={r.id} className="flex flex-col gap-1.5 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-text">{r.title}</span>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => run(() => addToBasket({ recipeId: r.id, title: r.title }))}
                >
                  Add to basket
                </Button>
              </div>
              {badge && (
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    title={badge.title}
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${badge.className}`}
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
