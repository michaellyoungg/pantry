/**
 * The native tab bar, derived from the shared `NAV_ITEMS` in `@pantry/core`.
 *
 * BL-0054 moved the destination list into `@pantry/core`, so this is no longer
 * a hand-kept copy: order, labels, and icon names come from the shared list and
 * cannot drift. What stays local is the part that is genuinely per-platform —
 * the Expo Router route name — which is exactly rule 5 of the parity plan:
 * neither router's vocabulary belongs in shared code.
 *
 * `icon` is a lucide name, not a glyph. `app/(tabs)/_layout.tsx` binds it to
 * `lucide-react-native`; the web app binds the same names to `lucide-react`.
 */
import { type NavIconName, type NavRoute, NAV_ITEMS as SHARED_NAV_ITEMS } from "@pantry/core";

/**
 * Per-tab facts only the native client has. Typed `Record<NavRoute, …>` so a
 * destination added in `@pantry/core` is a compile error here until it is
 * given a route file and an owner.
 */
const NATIVE_TABS: Record<NavRoute, { name: string; portedBy: string }> = {
  "/": { name: "index", portedBy: "BL-0062" },
  "/plan": { name: "plan", portedBy: "BL-0064" },
  "/recipes": { name: "recipes", portedBy: "BL-0063" },
  "/list": { name: "list", portedBy: "BL-0057" },
  "/pantry": { name: "pantry", portedBy: "BL-0059" },
  "/history": { name: "history", portedBy: "BL-0067" },
  "/settings": { name: "settings", portedBy: "BL-0066" },
};

export interface MobileNavItem {
  /** File-based route name inside `app/(tabs)`. */
  readonly name: string;
  readonly label: string;
  /** lucide icon name, shared with web. */
  readonly icon: NavIconName;
  /** The web route this mirrors. */
  readonly webPath: NavRoute;
  /** Backlog item that replaces the placeholder with the real screen. */
  readonly portedBy: string;
}

export const NAV_ITEMS: readonly MobileNavItem[] = SHARED_NAV_ITEMS.map((item) => ({
  name: NATIVE_TABS[item.to].name,
  label: item.label,
  icon: item.icon,
  webPath: item.to,
  portedBy: NATIVE_TABS[item.to].portedBy,
}));
