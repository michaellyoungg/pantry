import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// One shared mutation spy for setState/remove (mirrors GroceryList.test /
// WeekPlan.test), plus a dedicated setUseItUp spy so its tests can assert
// against it directly without relying on cross-mutation arg-shape guessing.
// useMutation dispatches on which api.pantry.* ref it was called with, the
// same technique Home.test.tsx uses for useQuery via getFunctionName.
const { state, mutationMock, setUseItUp } = vi.hoisted(() => ({
  state: { rows: [] as Array<Record<string, unknown>> },
  mutationMock: vi.fn(() => Promise.resolve()),
  setUseItUp: vi.fn(() => Promise.resolve()),
}));

vi.mock("convex/react", async () => {
  const { getFunctionName } = await import("convex/server");
  return {
    useQuery: () => state.rows,
    useMutation: (ref: Parameters<typeof getFunctionName>[0]) => {
      const spy = getFunctionName(ref).endsWith("setUseItUp") ? setUseItUp : mutationMock;
      const fn = ((...args: unknown[]) =>
        (spy as (...a: unknown[]) => Promise<unknown>)(...args)) as unknown as {
        (...a: unknown[]): Promise<unknown>;
        withOptimisticUpdate: (u: unknown) => typeof fn;
      };
      fn.withOptimisticUpdate = () => fn;
      return fn;
    },
  };
});

import { Pantry } from "./Pantry";

const rows = [
  {
    _id: "p1",
    userId: "dev-user",
    canonicalItem: "butter",
    display: "Butter",
    aisle: "dairy",
    state: "have",
    source: "auto",
    useItUp: false,
    updatedAt: 0,
    _creationTime: 0,
  },
  {
    _id: "p2",
    userId: "dev-user",
    canonicalItem: "green onion",
    display: "Green onion",
    aisle: "produce",
    state: "low",
    source: "manual",
    useItUp: true,
    updatedAt: 0,
    _creationTime: 0,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  state.rows = rows;
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("Pantry", () => {
  it("groups items under aisle headings", () => {
    render(<Pantry />);
    expect(screen.getByRole("heading", { name: /dairy/i })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /produce/i })).toBeTruthy();
    expect(screen.getByText("Butter")).toBeTruthy();
    expect(screen.getByText("Green onion")).toBeTruthy();
  });

  it("cycles state have -> low when the state button is clicked", () => {
    render(<Pantry />);
    fireEvent.click(screen.getByRole("button", { name: /butter is: have/i }));
    expect(mutationMock).toHaveBeenCalledWith({ id: "p1", state: "low" });
  });

  it("cycles out -> have, wrapping around", () => {
    state.rows = [{ ...rows[0], state: "out" }];
    render(<Pantry />);
    fireEvent.click(screen.getByRole("button", { name: /butter is: out/i }));
    expect(mutationMock).toHaveBeenCalledWith({ id: "p1", state: "have" });
  });

  it("removes an item", () => {
    render(<Pantry />);
    fireEvent.click(screen.getByRole("button", { name: /remove butter/i }));
    expect(mutationMock).toHaveBeenCalledWith({ id: "p1" });
  });

  it("explains how the pantry fills up when empty", () => {
    state.rows = [];
    render(<Pantry />);
    expect(screen.getByText(/check items off your grocery list/i)).toBeTruthy();
  });

  it("marks a row to use up", () => {
    render(<Pantry />);
    fireEvent.click(screen.getByRole("button", { name: "Mark Butter to use up" }));
    expect(setUseItUp).toHaveBeenCalledWith({ id: "p1", useItUp: true });
  });

  it("shows a flagged row as already marked", () => {
    render(<Pantry />);
    expect(screen.getByRole("button", { name: /Stop using up/ })).toBeTruthy();
  });
});

describe("Pantry approximate use-by (BL-0029)", () => {
  it("shows a relative, tilde-marked date so it can't be read as a printed label", () => {
    // 5.5 days out, so the floor-to-whole-days phrasing can't race the clock.
    state.rows = [{ ...rows[0], useBy: Date.now() + 5.5 * 86_400_000 }];
    render(<Pantry />);
    expect(screen.getByText("~5 days")).toBeTruthy();
  });

  it("shows nothing for an item with no known shelf life", () => {
    state.rows = [{ ...rows[0], useBy: undefined }];
    render(<Pantry />);
    expect(screen.queryByText(/^~/)).toBeNull();
  });

  it("labels the date as approximate for assistive tech", () => {
    state.rows = [{ ...rows[0], useBy: Date.now() + 5.5 * 86_400_000 }];
    render(<Pantry />);
    expect(screen.getByText("~5 days").getAttribute("title")).toMatch(/estimate/i);
  });
});
