import { api } from "@pantry/convex/api";
import { useKitchenUnlocks } from "@pantry/core/data";
import { useTracedAction } from "../telemetry/useTracedAction";
import { ErrorText } from "./ErrorText";
import { RecipeDetails } from "./RecipeDetails";
import { Button } from "./ui/Button";

/**
 * "I just got a panini press — what can I make?"
 *
 * The headline moment of BL-0043. Deliberately scoped to what the device
 * *changed*: recipes that were already cookable are excluded upstream, because
 * being told you can now make the roast chicken you have always been able to
 * make is not a discovery.
 *
 * An empty result is a real, common answer — the catalog simply has nothing
 * that needs this device — and is worded as such rather than as a failure.
 *
 * Presentation over `useKitchenUnlocks()` since BL-0063.
 */
export function KitchenUnlocks({
  equipmentId,
  name,
  onDismiss,
}: {
  equipmentId: string;
  /** Display name of the device, for copy. */
  name: string;
  onDismiss: () => void;
}) {
  const { recipes, loading, error, addError, reload, addToBasket } = useKitchenUnlocks(
    equipmentId,
    { unlockedBy: useTracedAction(api.equipment.unlockedBy, "equipment.unlockedBy") },
  );

  return (
    <section
      aria-label={`New with your ${name}`}
      className="rounded-lg border border-primary/30 bg-primary/5 p-4"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-semibold text-text">New with your {name}</h3>
        <Button variant="ghost" size="sm" onClick={onDismiss} aria-label="Dismiss">
          ×
        </Button>
      </div>

      {loading && <p className="mt-1 text-sm text-muted">Looking for recipes…</p>}
      {error && (
        <div className="mt-1 flex items-center gap-2">
          <ErrorText message={error} />
          <Button variant="secondary" size="sm" onClick={reload}>
            Retry
          </Button>
        </div>
      )}
      {!loading && !error && recipes.length === 0 && (
        <p className="mt-1 text-sm text-muted">
          Nothing in your recipes or the catalog needs a {name.toLowerCase()} yet — but it'll show
          up here when something does.
        </p>
      )}

      {recipes.length > 0 && (
        <>
          <p className="mt-1 text-sm text-muted">
            {recipes.length === 1
              ? "One recipe you couldn't make before:"
              : `${recipes.length} recipes you couldn't make before:`}
          </p>
          <ul className="mt-2 flex flex-col divide-y divide-border">
            {recipes.map((r) => (
              <li key={r.id} className="flex flex-col gap-1.5 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-text">{r.title}</span>
                  <Button variant="secondary" size="sm" onClick={() => addToBasket(r)}>
                    Add to basket
                  </Button>
                </div>
                <RecipeDetails recipe={r} />
              </li>
            ))}
          </ul>
        </>
      )}
      <ErrorText message={addError} />
    </section>
  );
}
