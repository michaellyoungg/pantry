import { api } from "@pantry/convex/api";
import type { DietPreset, NutritionTarget, NutritionTargetPeriod } from "@pantry/types";
import { useMutation } from "convex/react";
import { useCallback, useState } from "react";
import { DIET_PRESETS } from "../dietPresets";
import { HEADLINE_NUTRIENTS, nutrientMeta } from "../nutrition";
import { GOAL_PERIODS, parseGoalValue } from "../nutritionGoals";
import { useAsyncAction } from "../react/useAsyncAction";
import { type NutritionTargetRow, useNutritionTargets } from "./useNutritionTargets";

/** The goals of one window, under the heading that names it. */
export type GoalGroup = {
  period: NutritionTargetPeriod;
  /** "Per day". */
  heading: string;
  rows: NutritionTargetRow[];
};

/** The half-written goal in the add form. */
export type GoalDraft = {
  nutrientId: string;
  operator: NutritionTarget["operator"];
  /** As typed, so the field can hold "" and "1." on the way to a number. */
  value: string;
  period: NutritionTargetPeriod;
};

const EMPTY_DRAFT: GoalDraft = {
  nutrientId: HEADLINE_NUTRIENTS[0].id,
  operator: ">=",
  value: "",
  period: "day",
};

export type UseNutritionGoals = {
  /** Every stored goal, in the order Convex returns them. */
  targets: NutritionTargetRow[];
  /** The same goals bucketed by window; a window with no goal is omitted. */
  groups: GoalGroup[];
  /** True until the first response. Distinct from "you have no goals". */
  loading: boolean;
  presets: readonly DietPreset[];
  draft: GoalDraft;
  patchDraft: (patch: Partial<GoalDraft>) => void;
  /** The unit the drafted nutrient is written in, for the amount field's label. */
  draftUnit: string;
  /** False while the typed amount is not a number a goal could be made of. */
  canAdd: boolean;
  /** Stores the draft and clears the amount. A no-op while `canAdd` is false. */
  addGoal: () => void;
  removeGoal: (row: NutritionTargetRow) => void;
  /** Pause a goal, or resume it. A paused goal is kept, never evaluated. */
  togglePaused: (row: NutritionTargetRow) => void;
  /** Promote a goal to a hard constraint, or demote it back to a preference. */
  toggleHard: (row: NutritionTargetRow) => void;
  applyPreset: (preset: DietPreset) => void;
  pending: boolean;
  error: string | null;
};

/**
 * The nutrition goal editor (BL-0038), with no view attached.
 *
 * Every control edits the *same* row shape — `{nutrientId, operator, value,
 * period}` — because that is the only shape the system has. There is no
 * "low-carb mode" toggle to keep in sync with a threshold constant, the
 * nutrient list is the shared catalog, and the diet buttons are the shared
 * preset data, so a new diet is an entry in `dietPresets.json` and nothing else.
 *
 * The draft lives here rather than in either editor: "what counts as a usable
 * amount" is a rule, and a rule each client re-implements is a rule they will
 * eventually disagree on.
 */
export function useNutritionGoals(): UseNutritionGoals {
  const { targets: rows, loading } = useNutritionTargets();
  const add = useMutation(api.nutritionTargets.add);
  const remove = useMutation(api.nutritionTargets.remove);
  const setActive = useMutation(api.nutritionTargets.setActive);
  const setHard = useMutation(api.nutritionTargets.setHard);
  const applyPresetMutation = useMutation(api.nutritionTargets.applyPreset);
  const { run, error, pending } = useAsyncAction();

  const [draft, setDraft] = useState<GoalDraft>(EMPTY_DRAFT);
  const patchDraft = useCallback(
    (patch: Partial<GoalDraft>) => setDraft((current) => ({ ...current, ...patch })),
    [],
  );

  const amount = parseGoalValue(draft.value);

  return {
    targets: rows,
    groups: GOAL_PERIODS.flatMap(({ value, heading }) => {
      const inPeriod = rows.filter((row) => row.period === value);
      return inPeriod.length === 0 ? [] : [{ period: value, heading, rows: inPeriod }];
    }),
    loading,
    presets: DIET_PRESETS,
    draft,
    patchDraft,
    draftUnit: nutrientMeta(draft.nutrientId)?.unit ?? "",
    canAdd: amount !== null,
    addGoal: () => {
      // A goal with no number is not a goal. Bail rather than storing NaN, which
      // the mutation would reject anyway — one round trip later.
      if (amount === null) return;
      void run(async () => {
        await add({
          nutrientId: draft.nutrientId,
          operator: draft.operator,
          value: amount,
          period: draft.period,
        });
        patchDraft({ value: "" });
      });
    },
    removeGoal: (row) => void run(() => remove({ id: row._id })),
    togglePaused: (row) => void run(() => setActive({ id: row._id, active: !row.active })),
    toggleHard: (row) => void run(() => setHard({ id: row._id, hard: row.hard !== true })),
    applyPreset: (preset) => void run(() => applyPresetMutation({ targets: preset.targets })),
    pending,
    error,
  };
}
