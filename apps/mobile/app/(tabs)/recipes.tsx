/**
 * The recipes tab, native (BL-0063): the user's own collection, the seeded
 * catalog and the equipment inventory, one segmented control apart.
 *
 * `?section=` is how another screen asks for one of the three — Settings points
 * at the kitchen this way (BL-0066). Read here rather than in the screen, so
 * the screen stays renderable without a router.
 */
import { useLocalSearchParams } from "expo-router";
import { RecipesScreen } from "../../src/recipes/RecipesScreen";

export default function RecipesRoute() {
  const { section } = useLocalSearchParams<{ section?: string }>();

  return <RecipesScreen section={section} />;
}
