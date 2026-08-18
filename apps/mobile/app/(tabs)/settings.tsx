/**
 * The settings route, native (BL-0066) — the standing setup the recommender
 * reads: household size, equipment, the avoid list and tastes.
 *
 * Thin, like every other route here: the screen lives in `src/settings/` so it
 * can be rendered by a test without expo-router, and so `app/` stays a map of
 * the router rather than a place features accumulate.
 */
import { SettingsScreen } from "../../src/settings/SettingsScreen";

export default function Settings() {
  return <SettingsScreen />;
}
