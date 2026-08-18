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
import type { Href } from "expo-router";

/**
 * Per-tab facts only the native client has. Typed `Record<NavRoute, …>` so a
 * destination added in `@pantry/core` is a compile error here until it is
 * given a route file and an owner.
 */
const NATIVE_TABS: Record<NavRoute, { name: string; href: Href; portedBy: string }> = {
  "/": { name: "index", href: "/", portedBy: "BL-0062" },
  "/plan": { name: "plan", href: "/plan", portedBy: "BL-0064" },
  "/recipes": { name: "recipes", href: "/recipes", portedBy: "BL-0063" },
  "/list": { name: "list", href: "/list", portedBy: "BL-0057" },
  "/pantry": { name: "pantry", href: "/pantry", portedBy: "BL-0059" },
  "/history": { name: "history", href: "/history", portedBy: "BL-0067" },
  "/settings": { name: "settings", href: "/settings", portedBy: "BL-0066" },
};

/**
 * Where a shared destination lives in *this* router.
 *
 * Written out per tab rather than derived from the web path: the `(tabs)`
 * group happens to be transparent in the URL today, so the two coincide, but
 * that is a fact about this file tree and not something shared code may
 * assume. A screen that wants to send someone to the planner asks here.
 */
export function tabHref(route: NavRoute): Href {
  return NATIVE_TABS[route].href;
}

/**
 * Where one recipe's screen lives in *this* router (BL-0061).
 *
 * Recipe detail is a stack route rather than a tab, so it has no entry in
 * `NAV_ITEMS` and no `NavRoute` — but the path is still native-router
 * vocabulary, and rule 5 keeps that out of shared code and out of the views.
 * Screens ask here rather than building the string themselves, so there is one
 * place to change when the route moves.
 */
export function recipeHref(recipeId: string): Href {
  return `/recipe/${encodeURIComponent(recipeId)}`;
}

/** Cooking mode for one recipe: the same screen's step-by-step child route. */
export function cookModeHref(recipeId: string): Href {
  return `${recipeHref(recipeId)}/cook`;
}

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
