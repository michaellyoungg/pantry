import { api } from "@pantry/convex/api";
import { equipmentName } from "@pantry/core";
import { useMyKitchen } from "@pantry/core/data";
import { TEST_IDS } from "@pantry/core/testing";
import { useState } from "react";
import { useTracedAction } from "../telemetry/useTracedAction";
import { ErrorText } from "./ErrorText";
import { KitchenUnlocks } from "./KitchenUnlocks";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";

/**
 * My Kitchen — the equipment inventory (BL-0043).
 *
 * A plain set of checkboxes over the curated catalog, because inferring what
 * someone owns from what they have cooked cannot tell "doesn't own it" from
 * "hasn't cooked it" — and the new-device moment, which is the point of the
 * feature, is exactly when there is no history to infer from.
 *
 * Checking something opens its unlocks inline: telling the app what you own is
 * a chore, so the payoff arrives in the same breath rather than on some other
 * screen the user has to go find.
 *
 * Presentation over `useMyKitchen()` since BL-0063 — the catalog request, the
 * inventory subscription and the optimistic write are shared with the native
 * screen; what stays here is the checkbox layout and where the spotlight goes.
 */
export function MyKitchen() {
  const {
    catalog,
    groups,
    ownedIds,
    ownedCount,
    inventoryLoading,
    loading,
    catalogError,
    error: writeError,
    setOwned,
  } = useMyKitchen({
    listEquipment: useTracedAction(api.recipes.listEquipment, "recipes.listEquipment"),
  });
  // Which device's unlocks are on screen. Set by checking a box (the discovery
  // moment) and by the per-row button (so it can be revisited later).
  const [spotlight, setSpotlight] = useState<string | null>(null);

  function toggle(equipmentId: string, next: boolean) {
    // The write is optimistic, so the spotlight opens against a kitchen that
    // already contains the device rather than waiting a round trip to look right.
    setSpotlight(next ? equipmentId : (current) => (current === equipmentId ? null : current));
    setOwned(equipmentId, next);
  }

  return (
    <Card title="My Kitchen">
      <p className="text-sm text-muted">
        Tick what you cook with. We'll flag recipes you're missing equipment for — and show you what
        a new gadget unlocks.
      </p>

      {loading && catalog.length === 0 && (
        <p className="mt-3 text-sm text-muted">Loading equipment…</p>
      )}
      <ErrorText message={catalogError} />
      <ErrorText message={writeError} />

      {spotlight !== null && (
        <div className="mt-4">
          <KitchenUnlocks
            equipmentId={spotlight}
            name={equipmentName(catalog, spotlight)}
            onDismiss={() => setSpotlight(null)}
          />
        </div>
      )}

      {!inventoryLoading && (
        <p className="mt-4 text-xs text-muted">
          {ownedCount === 0
            ? "Nothing in your kitchen yet."
            : `${ownedCount} of ${catalog.length} in your kitchen.`}
        </p>
      )}

      <div className="mt-2 flex flex-col gap-4">
        {groups.map((group) => (
          <fieldset key={group.category}>
            <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">
              {group.label}
            </legend>
            <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
              {group.items.map((item) => {
                const isOwned = ownedIds.has(item.id);
                return (
                  <li key={item.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      id={`equipment-${item.id}`}
                      data-testid={TEST_IDS.recipes.equipment(item.id)}
                      checked={isOwned}
                      onChange={(e) => toggle(item.id, e.target.checked)}
                      className="h-4 w-4 shrink-0 accent-[var(--color-primary)]"
                    />
                    <label htmlFor={`equipment-${item.id}`} className="flex-1 text-text">
                      {item.name}
                    </label>
                    {isOwned && spotlight !== item.id && (
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`What can I make with my ${item.name}?`}
                        data-testid={TEST_IDS.recipes.unlocks(item.id)}
                        onClick={() => setSpotlight(item.id)}
                      >
                        What can I make?
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          </fieldset>
        ))}
      </div>
    </Card>
  );
}
