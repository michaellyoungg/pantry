import { api } from "@pantry/convex/api";
import { useAsyncAction } from "@pantry/core/react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import type { BasketRow, GroceryRow } from "../lib/homeState";
import { deriveHomeState } from "../lib/homeState";
import { useTracedAction } from "../telemetry/useTracedAction";
import { GettingStarted } from "./home/GettingStarted";
import { NextAction } from "./home/NextAction";
import { QuickActions } from "./home/QuickActions";
import { WeekStrip } from "./home/WeekStrip";

// Home is read-and-route (BL-0017): it shows where the weekly loop stands and offers
// exactly one next action. All state derives from the plan and the list — see
// lib/homeState.ts.
export function Home() {
  // Annotated, not cast: this is the one place a schema drift in basket/groceryList
  // would surface at compile time, and `as` would silence it.
  const basket: BasketRow[] | undefined = useQuery(api.basket.list);
  const list: GroceryRow[] | undefined = useQuery(api.groceryList.getGroceryList);
  const generate = useTracedAction(api.recipes.generateGroceryList, "recipes.generateGroceryList");
  const gen = useAsyncAction();
  const navigate = useNavigate();

  const state = deriveHomeState(basket, list);

  // Building the list from Home saves a hop through /plan on the most common weekly
  // action; on success we land on the list, ready to shop.
  async function buildList() {
    const result = await gen.run(() => generate({}));
    if (result !== undefined) await navigate({ to: "/list" });
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-2xl font-semibold text-text">Welcome to Pantry</h2>
        <p className="mt-1 text-muted">Plan meals, build one grocery list, shop, and cook.</p>
      </div>

      <NextAction state={state} onBuildList={buildList} pending={gen.pending} error={gen.error} />

      <WeekStrip basket={basket ?? []} />

      <QuickActions />

      <GettingStarted state={state} />
    </div>
  );
}
