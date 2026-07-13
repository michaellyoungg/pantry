import { useAuthActions } from "@convex-dev/auth/react";
import { createRootRoute, Outlet } from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import { Authenticated, Unauthenticated } from "convex/react";
import { useEffect, useState } from "react";
import { AuthForm } from "../components/AuthForm";
import { Nav } from "../components/Nav";
import { Button } from "../components/ui/Button";

function SignOutButton() {
  const { signOut } = useAuthActions();
  return (
    <Button variant="ghost" size="sm" onClick={() => signOut()} className="ml-auto">
      Sign out
    </Button>
  );
}

/**
 * Renders the router devtools, but keeps the floating toggle button hidden by
 * default so it doesn't sit in the way. Press Ctrl+Shift+D to toggle it.
 */
function Devtools() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.ctrlKey && event.shiftKey && (event.key === "D" || event.key === "d")) {
        event.preventDefault();
        setVisible((v) => !v);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  if (!visible) return null;
  return <TanStackRouterDevtools />;
}

function RootLayout() {
  return (
    <div className="min-h-screen">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-6xl items-center gap-2 px-6 py-4">
          <span className="text-2xl" aria-hidden>
            🥕
          </span>
          <h1 className="text-xl font-semibold tracking-tight text-text">Pantry</h1>
          <Authenticated>
            <SignOutButton />
          </Authenticated>
        </div>
      </header>
      <Unauthenticated>
        <main className="mx-auto max-w-5xl px-6 py-8">
          <div className="mx-auto max-w-sm">
            <AuthForm />
          </div>
        </main>
      </Unauthenticated>
      <Authenticated>
        <div className="mx-auto flex max-w-6xl">
          <Nav />
          <main className="min-w-0 flex-1 px-6 py-8 pb-24 sm:pb-8">
            <Outlet />
          </main>
        </div>
      </Authenticated>
      {import.meta.env.DEV ? <Devtools /> : null}
    </div>
  );
}

export const Route = createRootRoute({ component: RootLayout });
