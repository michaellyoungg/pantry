import type { PrepTask, PrepTaskInput } from "@pantry/types";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PrepEditor } from "./PrepEditor";

const derivedThaw: PrepTask = {
  key: "thaw_frozen_protein:chicken breast",
  ruleId: "thaw_frozen_protein",
  subject: "chicken breast",
  window: "night_before",
  text: "Move the chicken breast to the fridge to thaw",
  source: "rule",
  dueOn: "2026-08-09",
};

function setup(tasks: PrepTaskInput[] = [], derived: PrepTask[] = []) {
  const onChange = vi.fn();
  render(<PrepEditor tasks={tasks} onChange={onChange} derived={derived} />);
  return { onChange };
}

describe("PrepEditor", () => {
  it("adds a blank task with the most common window preselected", () => {
    const { onChange } = setup();
    fireEvent.click(screen.getByRole("button", { name: "+ prep task" }));
    expect(onChange).toHaveBeenCalledWith([{ text: "", window: "night_before" }]);
  });

  it("edits text and window", () => {
    const { onChange } = setup([{ text: "Make the pastry", window: "night_before" }]);

    fireEvent.change(screen.getByDisplayValue("Make the pastry"), {
      target: { value: "Make the pastry and chill it" },
    });
    expect(onChange).toHaveBeenCalledWith([
      { text: "Make the pastry and chill it", window: "night_before" },
    ]);

    fireEvent.change(screen.getByLabelText("When for prep task 1"), {
      target: { value: "two_days_before" },
    });
    expect(onChange).toHaveBeenCalledWith([{ text: "Make the pastry", window: "two_days_before" }]);
  });

  it("removes a task", () => {
    const { onChange } = setup([
      { text: "One", window: "at_start" },
      { text: "Two", window: "at_start" },
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Remove prep task 1" }));
    expect(onChange).toHaveBeenCalledWith([{ text: "Two", window: "at_start" }]);
  });

  // The whole reason keys are stable: overriding carries the derived task's key
  // onto the new one, which is what makes the server replace it rather than
  // show both.
  it("override copies the derived task's key onto a new task of yours", () => {
    const { onChange } = setup([], [derivedThaw]);

    fireEvent.click(
      screen.getByRole("button", {
        name: "Override: Move the chicken breast to the fridge to thaw",
      }),
    );

    expect(onChange).toHaveBeenCalledWith([
      {
        key: "thaw_frozen_protein:chicken breast",
        window: "night_before",
        text: "Move the chicken breast to the fridge to thaw",
      },
    ]);
  });

  it("stops offering a derived task once it has been overridden", () => {
    setup(
      [{ key: derivedThaw.key, window: "two_days_before", text: "Out on Sunday" }],
      [derivedThaw],
    );
    expect(screen.queryByRole("button", { name: /^Override:/ })).toBeNull();
  });

  // Manual tasks come back in the merged list too; showing them under "derived"
  // would invite the user to override their own task with itself.
  it("does not offer your own tasks for override", () => {
    setup([], [{ ...derivedThaw, key: "manual:mine", source: "manual", text: "Mine" }]);
    expect(screen.queryByRole("button", { name: /^Override:/ })).toBeNull();
  });

  it("labels where a derived task came from", () => {
    setup([], [derivedThaw, { ...derivedThaw, key: "llm:x", source: "llm", text: "Model's task" }]);
    expect(screen.getByText("auto")).not.toBeNull();
    expect(screen.getByText("suggested")).not.toBeNull();
  });

  it("says nothing is written rather than showing an empty list", () => {
    setup();
    expect(screen.getByText("Nothing you've written for this recipe.")).not.toBeNull();
  });
});
