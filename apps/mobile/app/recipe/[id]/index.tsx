/**
 * The recipe screen, native (BL-0061). Reached by id — from the week strip on
 * Home today, and from the recipes list once BL-0063 lands.
 *
 * A stack route rather than a tab: cooking is something you enter from a
 * specific meal and leave again, and the seven tabs are the shared destination
 * list in `@pantry/core` (BL-0054), which this is deliberately not part of.
 */
import { useLocalSearchParams } from "expo-router";
import { RecipeDetailScreen } from "../../../src/cooking/RecipeDetailScreen";

export default function RecipeRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();

  return <RecipeDetailScreen recipeId={id} />;
}
