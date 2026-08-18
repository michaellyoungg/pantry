/**
 * The single state-aware next action, native (BL-0062).
 *
 * Presentational, exactly as `apps/web/src/components/home/NextAction.tsx` is:
 * which state the week is in comes from `useHome()`, and `HomeScreen` owns the
 * generate call and the routing. What this file decides is what one card says.
 *
 * There is deliberately never more than one primary action on screen. On a
 * phone this card is the first thing seen after unlocking, and a launch screen
 * that offers four equal choices is a launch screen that has not answered the
 * question it exists to answer.
 */
import type { HomeState } from "@pantry/core";
import { Pressable, Text, View } from "react-native";
import { surfaceTestIDs } from "../testing/testIDs";

const id = surfaceTestIDs("home");

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

export function NextAction({
  state,
  pending,
  error,
  onBuildList,
  onOpenPlan,
  onOpenList,
}: {
  state: HomeState;
  pending: boolean;
  error: string | null;
  onBuildList: () => void;
  onOpenPlan: () => void;
  onOpenList: () => void;
}) {
  if (state.kind === "loading") {
    return (
      <Card>
        <Text className="text-base text-muted" testID={id("next-action-loading")}>
          Working out where your week is up to…
        </Text>
      </Card>
    );
  }

  // The couch → in-store handoff: the highest-value moment in the weekly loop,
  // and the one this client exists for.
  if (state.kind === "shopping") {
    return (
      <Card highlighted>
        <Heading>Shopping day</Heading>
        <Body>
          {plural(state.remaining, "item", "items")} left to pick up
          {state.checked > 0 ? ` — ${state.checked} of ${state.total} already checked off` : ""}.
        </Body>
        <Cta
          label={`Shop ${plural(state.remaining, "item", "items")}`}
          onPress={onOpenList}
          testID={id("shop")}
        />
      </Card>
    );
  }

  // Nothing clears a fully-checked list, so this state persists while the user
  // plans the following week. It must keep offering the build action, or Home
  // dead-ends for the rest of the week.
  if (state.kind === "shopped") {
    return (
      <Card>
        <Heading>Shopping done</Heading>
        <Body>
          All {plural(state.total, "item", "items")} checked off. Time to cook — or start next week.
        </Body>
        <Cta label="Plan next week" onPress={onOpenPlan} testID={id("plan-week")} />
        {state.mealCount > 0 && (
          <Cta
            disabled={pending}
            label={
              pending
                ? "Building…"
                : `Rebuild grocery list (${plural(state.mealCount, "meal", "meals")})`
            }
            onPress={onBuildList}
            testID={id("build-list")}
            variant="secondary"
          />
        )}
        <ErrorLine message={error} />
      </Card>
    );
  }

  if (state.kind === "planned") {
    return (
      <Card>
        <Heading>Your week is planned</Heading>
        <Body>{plural(state.mealCount, "meal", "meals")} ready to turn into one grocery list.</Body>
        <Cta
          disabled={pending}
          label={
            pending
              ? "Building…"
              : `Build grocery list (${plural(state.mealCount, "meal", "meals")})`
          }
          onPress={onBuildList}
          testID={id("build-list")}
        />
        <ErrorLine message={error} />
      </Card>
    );
  }

  return (
    <Card>
      <Heading>Start your week</Heading>
      <Body>Pick a few dinners and Pantry turns them into one grocery list.</Body>
      <Cta label="Plan this week" onPress={onOpenPlan} testID={id("plan-week")} />
    </Card>
  );
}

function Card({ children, highlighted }: { children: React.ReactNode; highlighted?: boolean }) {
  return (
    <View
      className={`gap-2 rounded-xl border p-4 ${
        highlighted ? "border-primary bg-primary/5" : "border-border bg-surface"
      }`}
      testID={id("next-action")}
    >
      {children}
    </View>
  );
}

function Heading({ children }: { children: React.ReactNode }) {
  return (
    <Text className="text-lg font-semibold text-text" testID={id("next-action-heading")}>
      {children}
    </Text>
  );
}

function Body({ children }: { children: React.ReactNode }) {
  return <Text className="text-base text-muted">{children}</Text>;
}

/**
 * A full-width button. Web can put two CTAs side by side under a mouse; a
 * thumb reaching the top of a phone cannot aim at half a row, so they stack.
 */
function Cta({
  label,
  onPress,
  testID,
  disabled = false,
  variant = "primary",
}: {
  label: string;
  onPress: () => void;
  testID: string;
  disabled?: boolean;
  variant?: "primary" | "secondary";
}) {
  const primary = variant === "primary";
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      className={`mt-1 items-center rounded-xl px-4 py-3.5 ${
        primary ? "bg-primary" : "border border-border"
      } ${disabled ? "opacity-60" : ""}`}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
    >
      <Text className={`text-base font-semibold ${primary ? "text-surface" : "text-text"}`}>
        {label}
      </Text>
    </Pressable>
  );
}

function ErrorLine({ message }: { message: string | null }) {
  if (message === null) return null;
  return (
    <Text className="text-sm text-danger" testID={id("next-action-error")}>
      {message}
    </Text>
  );
}
