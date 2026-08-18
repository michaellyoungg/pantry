/**
 * Hand-authored prep tasks on the recipe form, native (BL-0044).
 *
 * Two halves, and the second is why this is not just a list of text inputs:
 *
 *  - **Yours** — the tasks you wrote. Text plus a window; no dates, because a
 *    recipe has no cook date until it is planned.
 *  - **Derived** — what the rule table (and, when configured, the importer)
 *    produces for this recipe, each with an *Override*. Overriding copies the
 *    derived task's key onto a new task of yours, which is what makes the
 *    server replace it rather than show both. Without the affordance the
 *    precedence rule exists but is unreachable.
 *
 * `derived` is empty while creating: a recipe that does not exist yet has
 * nothing to derive against.
 *
 * The window is a cycling button rather than web's `<select>`. React Native has
 * no picker in core, and six values in a fixed order cycle in fewer taps than
 * a modal wheel costs to open.
 */
import { PREP_WINDOW_LABELS } from "@pantry/core";
import { colorTokens } from "@pantry/design-tokens";
import type { PrepTask, PrepTaskInput, PrepWindow } from "@pantry/types";
import { Pressable, Text, TextInput, View } from "react-native";
import { CONTROL_TARGET_HEIGHT } from "../components/hitTargets";
import { PrepSourceBadge } from "../cooking/PrepSourceBadge";
import { surfaceTestIDs, testIDKey } from "../testing/testIDs";

const id = surfaceTestIDs("recipes");

const WINDOWS = Object.keys(PREP_WINDOW_LABELS) as PrepWindow[];

export function PrepTaskEditor({
  tasks,
  derived,
  onChange,
}: {
  tasks: PrepTaskInput[];
  /** The current merged tasks for this recipe, if it exists yet. */
  derived: PrepTask[];
  onChange: (tasks: PrepTaskInput[]) => void;
}) {
  // A derived task already overridden is not offered again — it is sitting in
  // the list above, and showing it twice would suggest the override did not take.
  const overridden = new Set(tasks.map((t) => t.key).filter(Boolean));
  const offered = derived.filter((t) => !overridden.has(t.key));

  function update(index: number, patch: Partial<PrepTaskInput>) {
    onChange(tasks.map((t, i) => (i === index ? { ...t, ...patch } : t)));
  }

  return (
    <View className="gap-2" testID={id("prep-editor")}>
      <Text className="text-xs font-semibold uppercase tracking-wide text-muted">Prep tasks</Text>

      {tasks.length === 0 && (
        <Text className="text-sm text-muted" testID={id("prep-editor-empty")}>
          Nothing you've written for this recipe.
        </Text>
      )}

      {tasks.map((task, index) => (
        <View
          className="gap-2 rounded-lg border border-border bg-surface p-3"
          // Authored tasks have no stable id until the server assigns a key, so
          // position is the only identity an editable list has.
          // oxlint-disable-next-line react/no-array-index-key -- position IS a row's identity here
          key={index}
        >
          <TextInput
            accessibilityLabel={`Prep task ${index + 1}`}
            autoCorrect={false}
            className="rounded-lg border border-border bg-bg px-3 py-2 text-base text-text"
            onChangeText={(text) => update(index, { text })}
            placeholder="What has to happen early?"
            placeholderTextColor={colorTokens.muted}
            style={{ minHeight: CONTROL_TARGET_HEIGHT }}
            testID={id("prep-text", `row-${index + 1}`)}
            value={task.text}
          />
          <View className="flex-row items-center gap-2">
            <Pressable
              accessibilityHint="Changes when this has to happen"
              accessibilityLabel={`When: ${PREP_WINDOW_LABELS[task.window]}`}
              accessibilityRole="button"
              className="items-center justify-center rounded-full border border-border px-3"
              onPress={() =>
                update(index, {
                  window: WINDOWS[(WINDOWS.indexOf(task.window) + 1) % WINDOWS.length],
                })
              }
              style={{ minHeight: CONTROL_TARGET_HEIGHT }}
              testID={id("prep-window", `row-${index + 1}`)}
            >
              <Text className="text-sm font-medium text-text">
                {PREP_WINDOW_LABELS[task.window]}
              </Text>
            </Pressable>
            <View className="flex-1" />
            <Pressable
              accessibilityLabel={`Remove prep task ${index + 1}`}
              accessibilityRole="button"
              className="items-center justify-center rounded-full px-3"
              onPress={() => onChange(tasks.filter((_, i) => i !== index))}
              style={{ minHeight: CONTROL_TARGET_HEIGHT }}
              testID={id("prep-remove", `row-${index + 1}`)}
            >
              <Text className="text-sm text-muted">Remove</Text>
            </Pressable>
          </View>
        </View>
      ))}

      <Pressable
        accessibilityLabel="Add a prep task"
        accessibilityRole="button"
        className="items-center justify-center self-start rounded-full border border-border px-4"
        onPress={() => onChange([...tasks, { text: "", window: "night_before" }])}
        style={{ minHeight: CONTROL_TARGET_HEIGHT }}
        testID={id("add-prep")}
      >
        <Text className="text-sm font-medium text-text">+ prep task</Text>
      </Pressable>

      {offered.length > 0 && (
        <View className="gap-2 border-t border-border pt-2" testID={id("prep-derived")}>
          <Text className="text-xs text-muted">
            Derived for this recipe — override one to replace it with your own wording.
          </Text>
          {offered.map((task) => (
            <View className="flex-row items-center gap-2" key={task.key}>
              <View className="flex-1 gap-1">
                <Text className="text-sm text-muted">{task.text}</Text>
                <View className="flex-row items-center gap-2">
                  <Text className="text-xs text-muted">{PREP_WINDOW_LABELS[task.window]}</Text>
                  <PrepSourceBadge source={task.source} />
                </View>
              </View>
              <Pressable
                accessibilityLabel={`Override: ${task.text}`}
                accessibilityRole="button"
                className="items-center justify-center rounded-full border border-border px-3"
                // The key is the whole mechanism: carrying it over is what turns
                // a new task into a replacement for that one.
                onPress={() =>
                  onChange([...tasks, { key: task.key, window: task.window, text: task.text }])
                }
                style={{ minHeight: CONTROL_TARGET_HEIGHT }}
                testID={id("prep-override", testIDKey(task.key))}
              >
                <Text className="text-sm font-medium text-text">Override</Text>
              </Pressable>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}
