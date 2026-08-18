/**
 * The add funnel (BL-0063): paste a link, review what came back, save.
 *
 * A stack route rather than a tab — it is something you enter and leave, so the
 * recipes tab keeps its place underneath and finishing is a back gesture.
 */
import { RecipeEditorScreen } from "../../src/recipes/RecipeEditorScreen";

export default function NewRecipeRoute() {
  return <RecipeEditorScreen />;
}
