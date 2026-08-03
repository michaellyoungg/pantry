import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { state, addMock, removeMock, setActiveMock, applyPresetMock } = vi.hoisted(() => ({
  state: { rows: [] as Array<Record<string, unknown>> },
  addMock: vi.fn(() => Promise.resolve("t1")),
  removeMock: vi.fn(() => Promise.resolve()),
  setActiveMock: vi.fn(() => Promise.resolve()),
  applyPresetMock: vi.fn(() => Promise.resolve()),
}));

vi.mock("convex/react", () => ({
  useQuery: () => state.rows,
  useMutation: (ref: { toString: () => string }) => {
    const name = String(ref);
    const pick = () => {
      if (name.includes("applyPreset")) return applyPresetMock;
      if (name.includes("setActive")) return setActiveMock;
      if (name.includes("remove")) return removeMock;
      return addMock;
    };
    const fn = ((...args: unknown[]) =>
      (pick() as (...a: unknown[]) => Promise<unknown>)(...args)) as unknown as {
      (...a: unknown[]): Promise<unknown>;
      withOptimisticUpdate: (u: unknown) => typeof fn;
    };
    fn.withOptimisticUpdate = () => fn;
    return fn;
  },
}));

vi.mock("@pantry/convex/api", () => ({
  api: {
    nutritionTargets: {
      list: "nutritionTargets:list",
      add: "nutritionTargets:add",
      remove: "nutritionTargets:remove",
      setActive: "nutritionTargets:setActive",
      applyPreset: "nutritionTargets:applyPreset",
    },
  },
}));

import { NutritionGoals } from "./NutritionGoals";

const proteinGoal = {
  _id: "t1",
  _creationTime: 0,
  userId: "dev-user",
  nutrientId: "1003",
  operator: ">=",
  value: 150,
  period: "day",
  active: true,
};

const cholesterolGoal = {
  _id: "t2",
  _creationTime: 0,
  userId: "dev-user",
  nutrientId: "1253",
  operator: "<=",
  value: 200,
  period: "day",
  label: "Low cholesterol",
  active: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  state.rows = [];
});
afterEach(() => vi.restoreAllMocks());

describe("NutritionGoals — listing", () => {
  it("invites the user to set a goal when they have none", () => {
    render(<NutritionGoals />);
    expect(screen.getByText(/no goals yet/i)).toBeTruthy();
  });

  it("reads each goal back as a rule", () => {
    state.rows = [proteinGoal];
    render(<NutritionGoals />);
    expect(screen.getByText(/Protein ≥ 150 g/)).toBeTruthy();
  });

  it("marks a paused goal as paused rather than hiding it", () => {
    state.rows = [cholesterolGoal];
    render(<NutritionGoals />);
    expect(screen.getByText(/paused/i)).toBeTruthy();
    // The full rule, not just the name — "Low cholesterol" alone also matches
    // the preset button, and a paused goal must show the number it is paused at.
    expect(screen.getByText("Low cholesterol: Cholesterol ≤ 200 mg")).toBeTruthy();
  });

  it("groups goals by the window they are measured over", () => {
    state.rows = [proteinGoal, { ...cholesterolGoal, _id: "t3", period: "week", active: true }];
    render(<NutritionGoals />);
    expect(screen.getByRole("heading", { name: /per day/i })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /per week/i })).toBeTruthy();
  });
});

describe("NutritionGoals — editing", () => {
  it("adds a goal from the form", async () => {
    render(<NutritionGoals />);
    fireEvent.change(screen.getByLabelText(/nutrient/i), { target: { value: "1253" } });
    fireEvent.change(screen.getByLabelText(/limit|rule/i), { target: { value: "<=" } });
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "200" } });
    fireEvent.change(screen.getByLabelText(/per/i), { target: { value: "day" } });
    fireEvent.click(screen.getByRole("button", { name: /add goal/i }));

    await vi.waitFor(() =>
      expect(addMock).toHaveBeenCalledWith(
        expect.objectContaining({ nutrientId: "1253", operator: "<=", value: 200, period: "day" }),
      ),
    );
  });

  it("refuses to submit a goal with no amount", async () => {
    render(<NutritionGoals />);
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: /add goal/i }));
    expect(addMock).not.toHaveBeenCalled();
  });

  it("pauses a goal without deleting it", async () => {
    state.rows = [proteinGoal];
    render(<NutritionGoals />);
    fireEvent.click(screen.getByRole("button", { name: /pause/i }));
    await vi.waitFor(() => expect(setActiveMock).toHaveBeenCalledWith({ id: "t1", active: false }));
    expect(removeMock).not.toHaveBeenCalled();
  });

  it("resumes a paused goal", async () => {
    state.rows = [cholesterolGoal];
    render(<NutritionGoals />);
    fireEvent.click(screen.getByRole("button", { name: /resume/i }));
    await vi.waitFor(() => expect(setActiveMock).toHaveBeenCalledWith({ id: "t2", active: true }));
  });

  it("deletes a goal", async () => {
    state.rows = [proteinGoal];
    render(<NutritionGoals />);
    fireEvent.click(screen.getByRole("button", { name: /remove/i }));
    await vi.waitFor(() => expect(removeMock).toHaveBeenCalledWith({ id: "t1" }));
  });
});

describe("NutritionGoals — diet presets", () => {
  it("offers the presets that ship as data", () => {
    render(<NutritionGoals />);
    expect(screen.getByRole("button", { name: /low cholesterol/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /high protein/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /low carb/i })).toBeTruthy();
  });

  it("applies a preset as a bundle of ordinary target rows", async () => {
    // The mutation must receive rows, never a preset name — that is what keeps a
    // new diet a data edit rather than a deploy of new code.
    render(<NutritionGoals />);
    fireEvent.click(screen.getByRole("button", { name: /low carb/i }));
    await vi.waitFor(() => expect(applyPresetMock).toHaveBeenCalled());
    const [{ targets }] = applyPresetMock.mock.calls[0] as unknown as [
      { targets: Array<Record<string, unknown>> },
    ];
    expect(targets.length).toBeGreaterThan(0);
    expect(targets[0]).toEqual(
      expect.objectContaining({ nutrientId: expect.any(String), operator: expect.any(String) }),
    );
    expect(targets[0]).not.toHaveProperty("active");
  });

  it("explains what a preset will do before it is applied", () => {
    render(<NutritionGoals />);
    expect(screen.getByText(/Under 50 g of carbohydrate a day/i)).toBeTruthy();
  });
});
