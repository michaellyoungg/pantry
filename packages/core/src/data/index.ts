// @pantry/core/data — one headless hook per screen (BL-0055).
//
// Each hook owns that screen's Convex wiring: its subscriptions, its mutations
// and their optimistic updates, and every value derived from them. It returns
// data, actions and derived state, and nothing else — no elements, no styling,
// no navigation. A view over one of these is presentation.
//
// Convex's React hooks run unchanged under React Native, so `apps/web` and
// `apps/mobile` share these verbatim rather than each authoring the wiring and
// then drifting.
//
// Adding a screen hook:
//   1. Name it for the screen (`useGroceryList`, `usePantry`), not the table.
//   2. Return a named, exported `Use*` type. It is the contract two clients
//      read; an inferred shape is not reviewable.
//   3. Derive row types from the query (`FunctionReturnType<typeof api.x.y>`).
//      Restating one by hand erases Convex's `Id` brand, and every mutation
//      takes the branded id.
//   4. Build on `@pantry/core` and `@pantry/core/react` — reuse the pure
//      helpers and `useAsyncAction`/`useAsyncData` rather than re-deriving.
//   5. Leave genuinely per-platform concerns to the view: which sheet is open,
//      confirmation prompts, animation, navigation.
//
// Screens are migrated one at a time, as the native client reaches them; the
// remaining routes still wire Convex in their components.

export { type UseDeleteAccount, useDeleteAccount } from "./useDeleteAccount";
export {
  CART_TRANSITION_MS,
  type FinishChoice,
  type GroceryLine,
  type GroceryListOverride,
  type LeftoverProposal,
  REMOTE_HIGHLIGHT_MS,
  type RecentItem,
  type RestorableLine,
  UNDO_MS,
  type UseGroceryList,
  useGroceryList,
} from "./useGroceryList";
export { type GenerateGroceryList, type HomeMeal, type UseHome, useHome } from "./useHome";
export {
  type OfflineStatus,
  type UseOfflineGroceryList,
  useOfflineGroceryList,
} from "./useOfflineGroceryList";
export { type PantryItem, type PantryState, type UsePantry, usePantry } from "./usePantry";
export { type PrepForPlan, type UsePlanPrep, usePlanPrep } from "./usePlanPrep";
export { type WeekPlanRow, type UsePlanWeek, usePlanWeek } from "./usePlanWeek";
export {
  type GetRecipe,
  type ListEquipment,
  type RecipeEquipmentLine,
  type UseRecipeDetail,
  useRecipeDetail,
} from "./useRecipeDetail";
export { type PrepForRecipe, type UseRecipePrep, useRecipePrep } from "./useRecipePrep";
export { type UseItUpVariant, type UseUseItUp, useUseItUp } from "./useUseItUp";
export { type UseWeekSuggestion, useWeekSuggestion } from "./useWeekSuggestion";
