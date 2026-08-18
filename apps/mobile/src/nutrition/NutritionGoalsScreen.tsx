/**
 * The nutrition goal editor (BL-0038), native. Presentation over
 * `useNutritionGoals()`.
 *
 * Every control here edits the *same* row shape — `{nutrientId, operator, value,
 * period}` — because that is the only shape the system has. The nutrient list is
 * the shared catalog and the diet buttons are the shared preset data, so adding
 * a diet is an entry in `dietPresets.json` and nothing else.
 *
 * A screen rather than a section, which is the one composition choice that is
 * native's: web puts this on `/settings` beside four other cards, and a phone
 * has no room to stack an editor under them. Settings links here.
 *
 * The three `<select>`s web uses have no native equivalent worth emulating — a
 * picker wheel for three options is a modal for nothing — so each becomes a row
 * of chips. Same values, same vocabulary, both from `@pantry/core`.
 */
import {
  GOAL_OPERATORS,
  GOAL_PERIODS,
  goalLabel,
  HEADLINE_NUTRIENTS,
  type NutrientMeta,
} from "@pantry/core";
import { type NutritionTargetRow, useNutritionGoals } from "@pantry/core/data";
import type { DietPreset } from "@pantry/types";
import { useRouter } from "expo-router";
import type { ReactNode } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CONTROL_TARGET_HEIGHT } from "../components/hitTargets";
import { surfaceTestIDs, testIDKey } from "../testing/testIDs";

const id = surfaceTestIDs("settings");

/** A stored goal's own id segment: the nutrient and the window it applies to. */
function goalKey(row: NutritionTargetRow): string {
  return testIDKey(`${row.nutrientId}-${row.period}`);
}

export function NutritionGoalsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const {
    groups,
    loading,
    presets,
    draft,
    patchDraft,
    draftUnit,
    canAdd,
    addGoal,
    removeGoal,
    togglePaused,
    toggleHard,
    applyPreset,
    pending,
    error,
  } = useNutritionGoals();

  return (
    <View className="flex-1 bg-bg" testID={id("goals-screen")}>
      <ScrollView
        contentContainerClassName="gap-4 p-4 pb-16"
        contentContainerStyle={{ paddingTop: insets.top + 8 }}
      >
        {/* The stack renders no header, so the screen owns its own way back. */}
        <Pressable
          accessibilityLabel="Back"
          accessibilityRole="button"
          className="self-start rounded-full border border-border px-4 py-2.5"
          onPress={() => router.back()}
          testID={id("goals-back")}
        >
          <Text className="text-sm font-medium text-muted">← Back</Text>
        </Pressable>

        <Text className="text-2xl font-semibold text-text" testID={id("goals-title")}>
          Nutrition goals
        </Text>

        <Section title="Your goals">
          {groups.length === 0 ? (
            <Text className="text-sm text-muted" testID={id("goals-empty")}>
              {loading
                ? "Loading your goals…"
                : "No goals yet. Set one below, or start from a diet."}
            </Text>
          ) : (
            groups.map((group) => (
              <View className="gap-2" key={group.period}>
                <Text className="text-xs font-semibold uppercase tracking-wide text-muted">
                  {group.heading}
                </Text>
                {group.rows.map((row) => (
                  <GoalRow
                    key={row._id}
                    onRemove={() => removeGoal(row)}
                    onToggleHard={() => toggleHard(row)}
                    onTogglePaused={() => togglePaused(row)}
                    pending={pending}
                    row={row}
                  />
                ))}
              </View>
            ))
          )}
        </Section>

        <Section title="Add a goal">
          <ChipRow
            label="Nutrient"
            onSelect={(value) => patchDraft({ nutrientId: value })}
            options={HEADLINE_NUTRIENTS.map((n: NutrientMeta) => ({ value: n.id, label: n.label }))}
            selected={draft.nutrientId}
            testIDFor={(value) => id("goal-nutrient", testIDKey(`n-${value}`))}
          />
          <ChipRow
            label="Rule"
            onSelect={(value) =>
              patchDraft({ operator: value as (typeof GOAL_OPERATORS)[number]["value"] })
            }
            options={GOAL_OPERATORS.map((o) => ({ value: o.value, label: o.label }))}
            selected={draft.operator}
            testIDFor={(value) =>
              id(
                "goal-operator",
                value === ">=" ? "at-least" : value === "<=" ? "at-most" : "about",
              )
            }
          />

          <View className="gap-1">
            <Text className="text-xs text-muted">Amount{draftUnit && ` (${draftUnit})`}</Text>
            <TextInput
              accessibilityLabel={`Amount${draftUnit ? ` in ${draftUnit}` : ""}`}
              className="rounded-lg border border-border bg-surface px-3 text-base text-text"
              inputMode="decimal"
              keyboardType="decimal-pad"
              onChangeText={(value) => patchDraft({ value })}
              placeholder="0"
              style={{ minHeight: CONTROL_TARGET_HEIGHT }}
              testID={id("goal-amount")}
              value={draft.value}
            />
          </View>

          <ChipRow
            label="Per"
            onSelect={(value) =>
              patchDraft({ period: value as (typeof GOAL_PERIODS)[number]["value"] })
            }
            options={GOAL_PERIODS.map((p) => ({ value: p.value, label: p.label }))}
            selected={draft.period}
            testIDFor={(value) => id("goal-period", value)}
          />

          <Pressable
            accessibilityLabel="Add goal"
            accessibilityRole="button"
            accessibilityState={{ disabled: pending || !canAdd }}
            className={`items-center justify-center rounded-lg bg-primary px-4 ${
              pending || !canAdd ? "opacity-50" : ""
            }`}
            disabled={pending || !canAdd}
            onPress={addGoal}
            style={{ minHeight: CONTROL_TARGET_HEIGHT }}
            testID={id("goal-add")}
          >
            <Text className="text-base font-medium text-surface">Add goal</Text>
          </Pressable>

          <Text className="text-xs text-muted">
            Setting the same nutrient for the same window again re-tunes that goal rather than
            adding a second, contradictory one.
          </Text>
          <Text className="text-xs text-muted">
            Every goal starts as a preference: it moves suggestions up and down. Make one{" "}
            <Text className="font-medium text-text">required</Text> and recipes that break it stop
            being suggested at all. The rule you wrote does not decide that — you do.
          </Text>
        </Section>

        {/* Presets are data (`@pantry/core/dietPresets.json`), and applying one
            just writes ordinary target rows. Nothing downstream — the schema,
            the evaluator, this screen — knows a diet exists, which is why a new
            one costs an entry in a JSON file and nothing else. */}
        <Section title="Start from a diet">
          {presets.map((preset: DietPreset) => (
            <View className="gap-1.5" key={preset.id}>
              <Text className="text-sm font-medium text-text">{preset.label}</Text>
              <Text className="text-xs text-muted">{preset.description}</Text>
              <Pressable
                accessibilityLabel={`Use ${preset.label}`}
                accessibilityRole="button"
                accessibilityState={{ disabled: pending }}
                className={`items-center justify-center self-start rounded-lg border border-border px-4 ${
                  pending ? "opacity-50" : ""
                }`}
                disabled={pending}
                onPress={() => applyPreset(preset)}
                style={{ minHeight: CONTROL_TARGET_HEIGHT }}
                testID={id("goal-preset", testIDKey(preset.id))}
              >
                <Text className="text-sm font-medium text-text">Use {preset.label}</Text>
              </Pressable>
            </View>
          ))}
        </Section>

        {error !== null && (
          <Text className="text-sm text-danger" testID={id("goals-error")}>
            {error}
          </Text>
        )}
      </ScrollView>
    </View>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View className="gap-3 rounded-xl border border-border bg-surface p-4">
      <Text className="text-lg font-semibold text-text">{title}</Text>
      {children}
    </View>
  );
}

function GoalRow({
  row,
  pending,
  onRemove,
  onToggleHard,
  onTogglePaused,
}: {
  row: NutritionTargetRow;
  pending: boolean;
  onRemove: () => void;
  onToggleHard: () => void;
  onTogglePaused: () => void;
}) {
  return (
    <View className="gap-2 border-t border-border pt-2" testID={id("goal", goalKey(row))}>
      <View className="flex-row flex-wrap items-center gap-2">
        <Text className={`text-sm ${row.active ? "text-text" : "text-muted line-through"}`}>
          {goalLabel(row)}
        </Text>
        {/* A paused goal stays visible: hiding it would make the screen look
            like the goal was deleted, and the tuned number would be silently
            unrecoverable. */}
        {!row.active && (
          <Text className="rounded-xl bg-border px-2 py-0.5 text-xs text-muted">Paused</Text>
        )}
        {/* A required goal does something categorically different from a
            preferred one — it removes recipes. That has to be visible on the
            row, not buried in the button that set it. */}
        {row.hard && row.active && (
          <Text className="rounded-xl bg-danger/10 px-2 py-0.5 text-xs text-danger">Required</Text>
        )}
      </View>
      <View className="flex-row flex-wrap gap-2">
        <RowButton
          accessibilityLabel={
            row.hard
              ? `Make ${goalLabel(row)} a preference`
              : `Require ${goalLabel(row)}, removing recipes that break it from your suggestions`
          }
          disabled={pending}
          label={row.hard ? "Preferred" : "Require"}
          onPress={onToggleHard}
          testID={id("goal-hard", goalKey(row))}
        />
        <RowButton
          accessibilityLabel={`${row.active ? "Pause" : "Resume"} ${goalLabel(row)}`}
          disabled={pending}
          label={row.active ? "Pause" : "Resume"}
          onPress={onTogglePaused}
          testID={id("goal-pause", goalKey(row))}
        />
        <RowButton
          accessibilityLabel={`Remove ${goalLabel(row)}`}
          danger
          disabled={pending}
          label="Remove"
          onPress={onRemove}
          testID={id("goal-remove", goalKey(row))}
        />
      </View>
    </View>
  );
}

function RowButton({
  accessibilityLabel,
  danger,
  disabled,
  label,
  onPress,
  testID,
}: {
  accessibilityLabel: string;
  danger?: boolean;
  disabled: boolean;
  label: string;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      className={`items-center justify-center rounded-lg border px-3 ${
        danger ? "border-danger/40" : "border-border"
      } ${disabled ? "opacity-50" : ""}`}
      disabled={disabled}
      onPress={onPress}
      style={{ minHeight: CONTROL_TARGET_HEIGHT }}
      testID={testID}
    >
      <Text className={`text-sm font-medium ${danger ? "text-danger" : "text-text"}`}>{label}</Text>
    </Pressable>
  );
}

/** A `<select>`'s worth of options as a row of chips — three of them, always. */
function ChipRow({
  label,
  options,
  selected,
  onSelect,
  testIDFor,
}: {
  label: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  selected: string;
  onSelect: (value: string) => void;
  testIDFor: (value: string) => string;
}) {
  return (
    <View className="gap-1">
      <Text className="text-xs text-muted">{label}</Text>
      <View className="flex-row flex-wrap gap-2">
        {options.map((option) => {
          const active = option.value === selected;
          return (
            <Pressable
              accessibilityLabel={`${label}: ${option.label}`}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              className={`items-center justify-center rounded-xl border px-3 ${
                active ? "border-primary bg-primary/10" : "border-border"
              }`}
              key={option.value}
              onPress={() => onSelect(option.value)}
              style={{ minHeight: CONTROL_TARGET_HEIGHT }}
              testID={testIDFor(option.value)}
            >
              <Text className={`text-sm ${active ? "font-medium text-primary" : "text-text"}`}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
