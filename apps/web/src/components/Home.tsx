import { api } from "@pantry/convex/api";
import { useHome } from "@pantry/core/data";
import { useNavigate } from "@tanstack/react-router";
import { useTracedAction } from "../telemetry/useTracedAction";
import { BeforeYouCook } from "./BeforeYouCook";
import { GettingStarted } from "./home/GettingStarted";
import { NextAction } from "./home/NextAction";
import { QuickActions } from "./home/QuickActions";
import { WeekStrip } from "./home/WeekStrip";
import { UseItUp } from "./UseItUp";

// Home is read-and-route (BL-0017): it shows where the weekly loop stands and offers
// exactly one next action. Every value below is derived from the plan and the list by
// `useHome()` in @pantry/core/data, which the native launch screen renders from too.
export function Home() {
  const generate = useTracedAction(api.recipes.generateGroceryList, "recipes.generateGroceryList");
  const { state, days, unscheduled, pending, error, buildList } = useHome({ generate });
  const navigate = useNavigate();

  // On success we land on the list, ready to shop.
  async function onBuildList() {
    if (await buildList()) await navigate({ to: "/list" });
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-2xl font-semibold text-text">Welcome to Pantry</h2>
        <p className="mt-1 text-muted">Plan meals, build one grocery list, shop, and cook.</p>
      </div>

      <NextAction state={state} onBuildList={onBuildList} pending={pending} error={error} />

      {/* Lead-time prep for today (BL-0042). It sits ABOVE the expiry nudge and
          directly under the next action because it is the only card on Home
          that is time-critical in a way the user cannot recover from: a thaw
          missed today cannot be made up tomorrow. Renders nothing when there is
          nothing due. */}
      <BeforeYouCook />

      {/* Sits directly under the single next action and renders nothing when
          nothing is expiring, so it never competes with the weekly loop — it
          only interrupts when there is genuinely food about to be wasted. */}
      <UseItUp />

      <WeekStrip days={days} unscheduled={unscheduled} />

      <QuickActions />

      <GettingStarted state={state} />
    </div>
  );
}
