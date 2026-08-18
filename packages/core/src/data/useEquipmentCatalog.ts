import { api } from "@pantry/convex/api";
import type { EquipmentDef } from "@pantry/types";
import { useAction } from "convex/react";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { useCallback, useMemo } from "react";
import { useAsyncData } from "../react/useAsyncData";

/** `recipes.listEquipment`. Injectable so web can pass its traced wrapper. */
export type ListEquipmentDefs = (
  args: FunctionArgs<typeof api.recipes.listEquipment>,
) => Promise<FunctionReturnType<typeof api.recipes.listEquipment>>;

export type UseEquipmentCatalog = {
  catalog: EquipmentDef[];
  loading: boolean;
  error: string | null;
};

/**
 * The curated equipment catalog (BL-0041).
 *
 * Reference data — the same for every user — so a screen loads it once and
 * passes it down rather than each row fetching its own copy. Lived in
 * `apps/web/src/lib` until BL-0063 gave the native catalog, kitchen and recipe
 * editor the same need.
 */
export function useEquipmentCatalog({
  listEquipment,
}: { listEquipment?: ListEquipmentDefs } = {}): UseEquipmentCatalog {
  const listEquipmentAction = useAction(api.recipes.listEquipment);
  const fetchCatalog = listEquipment ?? listEquipmentAction;

  const load = useCallback(() => fetchCatalog({}), [fetchCatalog]);
  const { data, loading, error } = useAsyncData(load);

  return { catalog: useMemo(() => data ?? [], [data]), loading, error };
}
