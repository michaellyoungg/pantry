/**
 * Editing one recipe (BL-0063) — the same review surface as the add funnel,
 * seeded from what is stored.
 */
import { useLocalSearchParams } from "expo-router";
import { RecipeEditorScreen } from "../../../src/recipes/RecipeEditorScreen";

export default function EditRecipeRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();

  return <RecipeEditorScreen recipeId={id} />;
}
