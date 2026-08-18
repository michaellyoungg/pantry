/**
 * Cooking mode for one recipe (BL-0061): the method, one step at a time, with
 * the screen held awake. A route of its own so leaving it is a back gesture
 * rather than a mode to find your way out of.
 */
import { useLocalSearchParams } from "expo-router";
import { CookModeScreen } from "../../../src/cooking/CookModeScreen";

export default function CookRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();

  return <CookModeScreen recipeId={id} />;
}
