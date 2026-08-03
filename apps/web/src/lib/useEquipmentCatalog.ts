import { api } from "@pantry/convex/api";
import type { EquipmentDef } from "@pantry/types";
import { useAction } from "convex/react";
import { useCallback } from "react";
import { useAsyncData } from "./useAsyncData";

/**
 * Loads the curated equipment catalog (BL-0041). It is reference data — the
 * same for every user — so callers fetch it once per screen and pass it down
 * rather than each recipe row loading its own copy.
 */
export function useEquipmentCatalog(): {
  catalog: EquipmentDef[];
  loading: boolean;
  error: string | null;
} {
  const listEquipment = useAction(api.recipes.listEquipment);
  const load = useCallback(() => listEquipment({}), [listEquipment]);
  const { data, loading, error } = useAsyncData(load);
  return { catalog: data ?? [], loading, error };
}

/**
 * Resolves an equipment slug to its display name, falling back to the slug so a
 * tag whose catalog entry is missing (or whose catalog request failed) still
 * renders as something rather than disappearing.
 */
export function equipmentName(catalog: EquipmentDef[], id: string): string {
  return catalog.find((e) => e.id === id)?.name ?? id;
}
