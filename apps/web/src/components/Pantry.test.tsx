import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { state, mutationMock } = vi.hoisted(() => ({
  state: { rows: [] as Array<Record<string, unknown>> },
  mutationMock: vi.fn(() => Promise.resolve()),
}));

vi.mock("convex/react", () => ({
  useQuery: () => state.rows,
  useMutation: () => {
    const fn = ((...args: unknown[]) =>
      (mutationMock as (...a: unknown[]) => Promise<unknown>)(...args)) as unknown as {
      (...a: unknown[]): Promise<unknown>;
      withOptimisticUpdate: (u: unknown) => typeof fn;
    };
    fn.withOptimisticUpdate = () => fn;
    return fn;
  },
}));

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
