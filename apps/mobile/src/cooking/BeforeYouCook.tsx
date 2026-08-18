/**
 * "Before you cook" (BL-0042), native (BL-0061).
 *
 * The lead-time prep due today for this week's plan, with check-off.
 * Presentation over `usePlanPrep()` from `@pantry/core/data`, which the web
 * card renders from too — so both clients agree about what is due today, and
 * a tick made on one shows up on the other.
 *
 * The card exists because a derived task is worthless at the moment you need
 * it — "take the chicken out tonight" has to be said tonight. So it shows what
 * is due TODAY (and what was due earlier and never ticked), never the whole
 * week's prep, which would be a wall of things that are not yet actionable.
 *
 * Renders NOTHING when there is nothing to do, like `UseItUpCard`: Home offers
 * one next action, and an empty prep card would compete with it for no reason.
 *
 * What is native here is the target. Web draws a 16px checkbox next to a mouse;
 * this makes the whole row the control, because the phone is being tapped on
 * the way past the kitchen counter.
 */
import { dueByToday, formatDueOn, stateKey } from "@pantry/core";
import { usePlanPrep } from "@pantry/core/data";
import { useAsyncAction } from "@pantry/core/react";
import { Pressable, Text, View } from "react-native";
import { surfaceTestIDs, testIDKey } from "../testing/testIDs";
import { PrepSourceBadge } from "./PrepSourceBadge";

const id = surfaceTestIDs("home");

export function BeforeYouCook() {
  const { meals, today, done, setDone, loading } = usePlanPrep();
  const act = useAsyncAction();

  const due = dueByToday(meals, today);
  const outstanding = due.filter((d) => !done.has(stateKey(d.task.key, d.cookDate)));

  // Nothing due means no card at all — no empty state and no zero badge, the
  // same rule UseItUpCard follows. But a card whose tasks are all TICKED still
  // renders: hiding it the instant the last box is checked would take the undo
  // away with it, and the list is what the user just interacted with. It goes
  // away on its own tomorrow, when the tasks stop being due.
  if (loading || due.length === 0) return null;

  return (
    <View
      className="gap-2 rounded-xl border border-primary/40 bg-primary/5 p-4"
      testID={id("before-you-cook")}
    >
      <Text className="text-lg font-semibold text-text" testID={id("before-you-cook-heading")}>
        {outstanding.length === 0
          ? "Prep for today is done"
          : outstanding.length === 1
            ? "1 thing to do before you cook"
            : `${outstanding.length} things to do before you cook`}
      </Text>

      {due.map((d) => {
        const key = stateKey(d.task.key, d.cookDate);
        const checked = done.has(key);
        const slug = testIDKey(key);
        return (
          <Pressable
            accessibilityLabel={`${d.task.text} for ${d.title}`}
            accessibilityRole="checkbox"
            accessibilityState={{ checked }}
            className="flex-row items-start gap-3 border-t border-border py-3"
            key={key}
            onPress={() => act.run(() => setDone(d.task.key, d.cookDate, !checked))}
            testID={id("prep-task", slug)}
          >
            {/* Drawn rather than a platform checkbox: React Native has none, and
                a bare tick with no box does not read as something to press. */}
            <View
              className={`mt-0.5 h-7 w-7 items-center justify-center rounded-md border ${
                checked ? "border-primary bg-primary" : "border-border bg-surface"
              }`}
            >
              {checked && <Text className="text-base font-bold text-surface">✓</Text>}
            </View>

            <View className="flex-1 gap-1">
              <Text
                className={`text-base ${checked ? "text-muted line-through" : "text-text"}`}
                testID={id("prep-task-text", slug)}
              >
                {d.task.text}
              </Text>
              <View className="flex-row flex-wrap items-center gap-2">
                <Text className="text-sm text-muted">for {d.title}</Text>
                {/* A missed window is called out, never hidden. Finding out at
                    dinner time is the failure this whole feature prevents. */}
                <Text
                  className={`text-sm ${d.task.missed ? "font-semibold text-danger" : "text-muted"}`}
                  testID={id("prep-due", slug)}
                >
                  {formatDueOn(d.task.dueOn, today)}
                </Text>
                {/* Provenance (BL-0044). A derived task that is wrong for this
                    recipe is fixable on the recipe form; unlabelled, it just
                    looks like the app being wrong. */}
                <PrepSourceBadge source={d.task.source} testID={id("prep-source", slug)} />
              </View>
            </View>
          </Pressable>
        );
      })}

      {act.error !== null && (
        <Text className="text-sm text-danger" testID={id("prep-error")}>
          {act.error}
        </Text>
      )}
    </View>
  );
}
