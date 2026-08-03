// @pantry/core/convex — optimistic updates against the Convex client cache.
// Split from the pure entry point because these know the query contract; they
// stay free of React and the DOM, so any Convex client can install them.

export {
  addToBasketOptimistic,
  clearGroceryListOptimistic,
  needItAnywayOptimistic,
  removeFromBasketOptimistic,
  removePantryItemOptimistic,
  setEquipmentOwnedOptimistic,
  setPantryStateOptimistic,
  toggleItemOptimistic,
} from "./optimistic";
