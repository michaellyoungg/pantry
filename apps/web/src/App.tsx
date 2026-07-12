import { useState } from "react";
import { Authenticated, Unauthenticated } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { RecipeForm } from "./components/RecipeForm";
import { RecipeList } from "./components/RecipeList";
import { Basket } from "./components/Basket";
import { GroceryList } from "./components/GroceryList";
import { AuthForm } from "./components/AuthForm";
import { Button } from "./components/ui/Button";

function SignOutButton() {
  const { signOut } = useAuthActions();
  return (
    <Button variant="ghost" size="sm" onClick={() => signOut()} className="ml-auto">
      Sign out
    </Button>
  );
}

export default function App() {
  const [refreshKey, setRefreshKey] = useState(0);
  return (
    <div className="min-h-screen">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-5xl items-center gap-2 px-6 py-4">
          <span className="text-2xl" aria-hidden>
            🥕
          </span>
          <h1 className="text-xl font-semibold tracking-tight text-text">Pantry</h1>
          <Authenticated>
            <SignOutButton />
          </Authenticated>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">
        <Unauthenticated>
          <div className="mx-auto max-w-sm">
            <AuthForm />
          </div>
        </Unauthenticated>
        <Authenticated>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <RecipeForm onCreated={() => setRefreshKey((k) => k + 1)} />
            <RecipeList refreshKey={refreshKey} />
            <Basket />
            <GroceryList />
          </div>
        </Authenticated>
      </main>
    </div>
  );
}
