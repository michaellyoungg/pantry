import { Link } from "@tanstack/react-router";

type NavItem = { to: string; label: string; icon: string };

export const NAV_ITEMS: NavItem[] = [
  { to: "/", label: "Home", icon: "🏠" },
  { to: "/plan", label: "Plan", icon: "🗓️" },
  { to: "/recipes", label: "Recipes", icon: "📖" },
  { to: "/list", label: "List", icon: "🛒" },
  { to: "/pantry", label: "Pantry", icon: "🥫" },
];

function NavLinks({ variant }: { variant: "sidebar" | "bottom" }) {
  const base =
    variant === "sidebar"
      ? "flex items-center gap-3 rounded-lg px-3 py-2 text-muted hover:bg-border/40 hover:text-text data-[active=true]:bg-primary/10 data-[active=true]:text-primary"
      : "flex flex-1 flex-col items-center gap-0.5 py-2 text-xs text-muted data-[active=true]:text-primary";
  return (
    <>
      {NAV_ITEMS.map((item) => (
        <Link
          key={item.to}
          to={item.to}
          activeOptions={{ exact: item.to === "/" }}
          activeProps={{ "aria-current": "page", "data-active": "true" }}
          className={base}
        >
          <span className="text-xl" aria-hidden>
            {item.icon}
          </span>
          <span className={variant === "sidebar" ? "hidden lg:inline" : ""}>{item.label}</span>
        </Link>
      ))}
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
