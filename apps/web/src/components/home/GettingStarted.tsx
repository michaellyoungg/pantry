import type { HomeState } from "../../lib/homeState";
import { Card } from "../ui/Card";

/**
 * Onboarding for the first pass through the weekly loop. It disappears once shopping
 * starts — by then the loop speaks for itself.
 */
export function GettingStarted({ state }: { state: HomeState }) {
  if (state.kind !== "empty" && state.kind !== "planned") return null;

  const steps = [
    { label: "Add meals to your week", done: state.kind === "planned" },
    { label: "Build your grocery list", done: false },
    { label: "Shop", done: false },
  ];

  return (
    <Card title="Getting started">
      <ol className="flex flex-col gap-2">
        {steps.map((step, i) => (
          <li key={step.label} className="flex items-center gap-2 text-sm">
            <span
              aria-hidden="true"
              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs ${
                step.done ? "bg-primary text-white" : "border border-border text-muted"
              }`}
            >
              {step.done ? "✓" : i + 1}
            </span>
            <span className={step.done ? "text-muted line-through" : "text-text"}>
              {step.label}
            </span>
          </li>
        ))}
      </ol>
    </Card>
  );
}
