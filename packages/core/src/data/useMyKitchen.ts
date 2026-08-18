import { api } from "@pantry/convex/api";
import type { EquipmentDef } from "@pantry/types";
import { useAction, useMutation, useQuery } from "convex/react";
import { useCallback, useMemo } from "react";
import { setEquipmentOwnedOptimistic } from "../convex/optimistic";
import { type EquipmentGroup, groupByCategory } from "../equipmentFit";
import { useAsyncAction } from "../react/useAsyncAction";
import { useAsyncData } from "../react/useAsyncData";
import type { ListEquipmentDefs } from "./useCatalog";

export type UseMyKitchen = {
  /** The curated equipment catalog (BL-0041), in catalog order. */
  catalog: EquipmentDef[];
  /** The catalog split into the sections the screen renders. */
  groups: EquipmentGroup[];
  /** Slugs the user has ticked. */
  ownedIds: Set<string>;
  /** How many of the catalog is ticked, for the "3 of 24" line. */
  ownedCount: number;
  /** True until the catalog arrives. */
  loading: boolean;
  /**
   * True until the inventory query resolves. Distinct from `loading`: the count
   * line must not claim "nothing in your kitchen yet" before the first response.
   */
  inventoryLoading: boolean;
  /** A failed catalog load, already stringified. */
  catalogError: string | null;
  /** The most recent failed write, already stringified. */
  error: string | null;
  isOwned: (equipmentId: string) => boolean;
  setOwned: (equipmentId: string, owned: boolean) => void;
};

/**
 * My Kitchen — the equipment inventory (BL-0043), with no view attached.
 *
 * A plain set of checkboxes over the curated catalog, because inferring what
 * someone owns from what they have cooked cannot tell "doesn't own it" from
 * "hasn't cooked it" — and the new-device moment, which is the point of the
 * feature, is exactly when there is no history to infer from.
 *
 * The write is optimistic so the unlocks a client opens on a tick render
 * against a kitchen that already contains the device, rather than waiting a
 * round trip to look right.
 */
export function useMyKitchen({
  listEquipment,
}: { listEquipment?: ListEquipmentDefs } = {}): UseMyKitchen {
  const listEquipmentAction = useAction(api.recipes.listEquipment);
  const fetchCatalog = listEquipment ?? listEquipmentAction;

  const load = useCallback(() => fetchCatalog({}), [fetchCatalog]);
  const { data, loading, error: catalogError } = useAsyncData(load);
  const owned = useQuery(api.equipment.list);
  const setOwnedMutation = useMutation(api.equipment.setOwned).withOptimisticUpdate(
    setEquipmentOwnedOptimistic,
  );
  const { run, error } = useAsyncAction();

  const catalog = useMemo(() => data ?? [], [data]);
  const ownedIds = useMemo(() => new Set((owned ?? []).map((row) => row.equipmentId)), [owned]);

  const setOwned = useCallback(
    (equipmentId: string, next: boolean) => {
      void run(() => setOwnedMutation({ equipmentId, owned: next }));
    },
    [run, setOwnedMutation],
  );

  return {
    catalog,
    groups: useMemo(() => groupByCategory(catalog), [catalog]),
    ownedIds,
    ownedCount: ownedIds.size,
    loading,
    inventoryLoading: owned === undefined,
    catalogError,
    error,
    isOwned: (equipmentId) => ownedIds.has(equipmentId),
    setOwned,
  };
}
