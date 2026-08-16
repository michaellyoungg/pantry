/**
 * The native tab bar, mirroring the web app's `NAV_ITEMS`.
 *
 * This is deliberately a *copy*, not an import. Navigation must not leak into
 * shared code (parity plan rule 5): web's list carries TanStack Router paths and
 * mobile's carries Expo Router route names, and neither router's vocabulary
 * belongs in `@pantry/core`. What is shared is the *order and labelling*, which
 * `navItems.test.ts` checks against `apps/web` so the two cannot silently
 * diverge.
 *
 * `icon` is still an emoji, matching web. BL-0054 replaces both with a real
 * icon set; until then the same character is used so the clients look alike.
 */
export interface MobileNavItem {
  /** File-based route name inside `app/(tabs)`. */
  readonly name: string;
  readonly label: string;
  readonly icon: string;
  /** The web route this mirrors. Used only by the drift test. */
  readonly webPath: string;
  /** Backlog item that replaces the placeholder with the real screen. */
  readonly portedBy: string;
}

export const NAV_ITEMS: readonly MobileNavItem[] = [
  { name: "index", label: "Home", icon: "🏠", webPath: "/", portedBy: "BL-0062" },
  { name: "plan", label: "Plan", icon: "🗓️", webPath: "/plan", portedBy: "BL-0064" },
  { name: "recipes", label: "Recipes", icon: "📖", webPath: "/recipes", portedBy: "BL-0063" },
  { name: "list", label: "List", icon: "🛒", webPath: "/list", portedBy: "BL-0057" },
  { name: "pantry", label: "Pantry", icon: "🥫", webPath: "/pantry", portedBy: "BL-0059" },
  { name: "history", label: "History", icon: "📈", webPath: "/history", portedBy: "BL-0067" },
  { name: "settings", label: "Settings", icon: "⚙️", webPath: "/settings", portedBy: "BL-0066" },
];
