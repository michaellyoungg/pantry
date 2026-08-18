import { api } from "@pantry/convex/api";
import { useMutation, useQuery } from "convex/react";
import { useCallback, useState } from "react";
import { useAsyncAction } from "../react/useAsyncAction";

export type UseHouseholdSizeEditor = {
  /**
   * What the field shows: the draft if there is one, otherwise the stored size,
   * and `""` for "I'd rather not say". A string rather than a number because
   * both clients edit this in a text field, and half-typed text is not a number.
   */
  value: string;
  setValue: (value: string) => void;
  /**
   * The typed value is not a whole number of people. Set by `save`, not by
   * `setValue`: complaining at someone mid-keystroke, while "1" is on its way
   * to "12", is not help.
   */
  invalid: boolean;
  /**
   * True until the stored size is known. Rendering the field before then would
   * show an empty box — indistinguishable from "you have not set this", and one
   * stray keystroke away from overwriting a real answer.
   */
  loading: boolean;
  pending: boolean;
  error: string | null;
  /** Store the typed value, or clear the preference when it is blank. */
  save: () => void;
};

/**
 * Editing how many people this household cooks for (BL-0018), headless
 * (BL-0055).
 *
 * The read side is `useHouseholdSize()`, which every "add to plan" surface
 * seeds its servings dial from. This is the settings half: a draft, the rule
 * that validates it, and the write. They are separate because the reader wants
 * one number and nothing else, and giving it a draft and a save button it will
 * never call would make every add funnel re-render on a keystroke here.
 *
 * One number, and it earns its place by removing taps rather than adding a
 * screen: the planner seeds each recipe's servings dial from it, so a household
 * of four adding a four-serving recipe never has to touch the stepper at all.
 *
 * Blank is a real answer — every recipe then starts at one batch, which is the
 * behaviour before this existed — so it goes through `preferences.
 * setHouseholdSize` rather than `set`, which merges on omission and therefore
 * cannot express a clear.
 *
 * The validation is here rather than in a view because it is arithmetic, not
 * presentation: this number divides into every scaled grocery quantity, and a
 * client that let a fraction through would multiply it through the whole list
 * before the server refused it.
 */
export function useHouseholdSizeEditor(): UseHouseholdSizeEditor {
  const prefs = useQuery(api.preferences.get);
  const save = useMutation(api.preferences.setHouseholdSize);
  const { run, error, pending } = useAsyncAction();
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);

  const stored = prefs?.householdSize === undefined ? "" : String(prefs.householdSize);
  const value = draft ?? stored;

  const submit = useCallback(() => {
    const text = value.trim();
    if (text === "") {
      setInvalid(false);
      void run(async () => {
        await save({});
        // Dropped so the field follows the stored value again; keeping the
        // draft would pin the box to text the server has since rejected or
        // rounded.
        setDraft(null);
      });
      return;
    }
    const size = Number(text);
    if (!Number.isInteger(size) || size < 1) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    void run(async () => {
      await save({ householdSize: size });
      setDraft(null);
    });
  }, [run, save, value]);

  return {
    value,
    setValue: setDraft,
    invalid,
    loading: prefs === undefined,
    pending,
    error,
    save: submit,
  };
}
