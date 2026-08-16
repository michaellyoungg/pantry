// The app's primary navigation destinations — the one list every client reads.
//
// `icon` holds a *name*, not a component. `lucide-react` and
// `lucide-react-native` export identical names, so each platform binds the name
// to its own component in its own view layer and no renderer-specific type
// crosses this boundary. That is what lets this module stay headless while
// still being the single source of the tab bar.
//
// Binding it: `apps/web/src/components/Nav.tsx` maps `NavIconName` to
// `lucide-react` components; a native client keeps the equivalent map against
// `lucide-react-native`. Typing the map as `Record<NavIconName, …>` makes a
// missing binding a compile error on the platform that forgot it.

/** A lucide icon export name, valid in both lucide React bindings. */
export type NavIconName =
  | "House"
  | "CalendarDays"
  | "BookOpen"
  | "ShoppingCart"
  | "Refrigerator"
  | "ChartLine"
  | "Settings";

/**
 * A destination's route path. A union rather than `string` so each client can
 * key an exhaustive `Record<NavRoute, …>` off it — adding a destination then
 * fails the build on any client that has not routed it.
 */
export type NavRoute = "/" | "/plan" | "/recipes" | "/list" | "/pantry" | "/history" | "/settings";

export type NavItem = {
  /** Route path. The web router uses it verbatim; a native router maps it. */
  to: NavRoute;
  /**
   * Visible text, and the link's accessible name — the Playwright `navigateTo`
   * helper and the Nav unit tests both locate by it, so it is load-bearing.
   */
  label: string;
  icon: NavIconName;
};

export const NAV_ITEMS: readonly NavItem[] = [
  { to: "/", label: "Home", icon: "House" },
  { to: "/plan", label: "Plan", icon: "CalendarDays" },
  { to: "/recipes", label: "Recipes", icon: "BookOpen" },
  { to: "/list", label: "List", icon: "ShoppingCart" },
  { to: "/pantry", label: "Pantry", icon: "Refrigerator" },
  { to: "/history", label: "History", icon: "ChartLine" },
  { to: "/settings", label: "Settings", icon: "Settings" },
];
