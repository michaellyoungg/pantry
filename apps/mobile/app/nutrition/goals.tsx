/**
 * Nutrition goals (BL-0038), ported by BL-0065.
 *
 * A stack route rather than a tab: web keeps this on `/settings` beside four
 * other cards, and a phone has no room to stack a whole editor under them. It
 * is entered from Settings and left again, and the seven tabs are the shared
 * destination list in `@pantry/core` (BL-0054), which this is not part of.
 */
import { NutritionGoalsScreen } from "../../src/nutrition/NutritionGoalsScreen";

export default function NutritionGoalsRoute() {
  return <NutritionGoalsScreen />;
}
