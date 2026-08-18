import { api } from "@pantry/convex/api";
import { useQuery } from "convex/react";

/**
 * The household size every "add to plan" surface seeds its servings dial from
 * (BL-0018). `undefined` covers both "still loading" and "never set", and both
 * mean the same thing to a caller: no default to apply, so the recipe starts at
 * a single batch — which is what happened before this preference existed.
 *
 * Small enough to have lived in `apps/web/src/lib`; it moved here with BL-0063
 * because both add funnels seed from it, and a second copy would be a second
 * place for the default to drift.
 */
export function useHouseholdSize(): number | undefined {
  return useQuery(api.preferences.get)?.householdSize;
}
