/**
 * The native half of the BL-0054 icon contract.
 *
 * `@pantry/core` names each destination's icon as a string; `lucide-react` and
 * `lucide-react-native` export identical names, so binding the name to a
 * component is the only per-platform piece. `apps/web` keeps the same map
 * against `lucide-react` in `src/components/Nav.tsx`.
 *
 * Icons are imported one subpath at a time (`lucide-react-native/icons/house`,
 * a supported export) rather than from the package barrel. The barrel re-exports
 * ~1,700 icons, and Metro does not tree-shake by default, so importing it would
 * pull every one into the app bundle. The subpath is the shared PascalCase name
 * in kebab-case — `ChartLine` → `chart-line`.
 *
 * `Record<NavIconName, …>` is deliberate: a destination added in
 * `@pantry/core` fails the build on either platform until its icon is bound.
 */
import type { NavIconName } from "@pantry/core";
import type { LucideIcon } from "lucide-react-native";
import BookOpen from "lucide-react-native/icons/book-open";
import CalendarDays from "lucide-react-native/icons/calendar-days";
import ChartLine from "lucide-react-native/icons/chart-line";
import House from "lucide-react-native/icons/house";
import Refrigerator from "lucide-react-native/icons/refrigerator";
import Settings from "lucide-react-native/icons/settings";
import ShoppingCart from "lucide-react-native/icons/shopping-cart";

export const NAV_ICONS: Record<NavIconName, LucideIcon> = {
  BookOpen,
  CalendarDays,
  ChartLine,
  House,
  Refrigerator,
  Settings,
  ShoppingCart,
};
