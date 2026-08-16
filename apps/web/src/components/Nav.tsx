import { NAV_ITEMS, type NavIconName } from "@pantry/core";
import { Link } from "@tanstack/react-router";
import {
  BookOpen,
  CalendarDays,
  ChartLine,
  House,
  type LucideIcon,
  Refrigerator,
  Settings,
  ShoppingCart,
} from "lucide-react";

/**
 * Binds each shared icon name to its `lucide-react` component.
 *
 * `NAV_ITEMS` lives in `@pantry/core` and names icons as strings so it can stay
 * headless; this map is the web half of that contract. A native client keeps
 * the same map against `lucide-react-native`, which exports identical names.
 * `Record<NavIconName, …>` is deliberate — adding a destination in core fails
 * the build on any platform that has not bound its icon.
 */
const NAV_ICONS: Record<NavIconName, LucideIcon> = {
  BookOpen,
  CalendarDays,
  ChartLine,
  House,
  Refrigerator,
  Settings,
  ShoppingCart,
};

function NavLinks({ variant }: { variant: "sidebar" | "bottom" }) {
  const base =
    variant === "sidebar"
      ? "flex items-center gap-3 rounded-lg px-3 py-2 text-muted hover:bg-border/40 hover:text-text data-[active=true]:bg-primary/10 data-[active=true]:text-primary"
      : "flex flex-1 flex-col items-center gap-0.5 py-2 text-xs text-muted data-[active=true]:text-primary";
  return (
    <>
      {NAV_ITEMS.map((item) => {
        const Icon = NAV_ICONS[item.icon];
        return (
          <Link
            key={item.to}
            to={item.to}
            activeOptions={{ exact: item.to === "/" }}
            activeProps={{ "aria-current": "page", "data-active": "true" }}
            className={base}
          >
            <Icon className="size-5 shrink-0" strokeWidth={1.75} aria-hidden focusable="false" />
            <span className={variant === "sidebar" ? "hidden lg:inline" : ""}>{item.label}</span>
          </Link>
        );
      })}
    </>
  );
}

export function Nav() {
  return (
    <>
      <nav
        aria-label="Main"
        className="hidden shrink-0 flex-col gap-1 border-r border-border bg-surface p-2 sm:flex sm:w-16 lg:w-56"
      >
        <NavLinks variant="sidebar" />
      </nav>
      <nav
        aria-label="Mobile"
        className="fixed inset-x-0 bottom-0 z-10 flex border-t border-border bg-surface sm:hidden"
      >
        <NavLinks variant="bottom" />
      </nav>
    </>
  );
}
