import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { state, mutationMock } = vi.hoisted(() => ({
  state: { proposals: [] as Array<Record<string, unknown>> },
  mutationMock: vi.fn(() => Promise.resolve(null)),
}));

vi.mock("convex/react", () => ({
  useQuery: () => state.proposals,
  useMutation: () => mutationMock,
}));

import { LeftoverProposals } from "./LeftoverProposals";

const parsley = {
  _id: "g1",
  item: "Parsley",
  aisle: "produce",
  quantity: 2,
  unit: "tbsp",
  purchase: { quantity: 1, unit: "bunch", residue: 6, residueUnit: "tbsp" },
};

describe("LeftoverProposals", () => {
  beforeEach(() => {
    mutationMock.mockClear();
    state.proposals = [parsley];
  });

  it("says nothing at all when there is nothing to propose", () => {
    state.proposals = [];
    const { container } = render(<LeftoverProposals />);
    expect(container.textContent).toBe("");
  });

  it("shows its own arithmetic, so the guess is inspectable", () => {
    render(<LeftoverProposals />);
    expect(screen.getByText(/6 tbsp of the 1 bunch you bought/)).toBeTruthy();
    expect(screen.getByText(/after the 2 tbsp your recipes wanted/)).toBeTruthy();
  });

  it("confirms one item at a time", () => {
    render(<LeftoverProposals />);
    fireEvent.click(screen.getByRole("button", { name: "Keep Parsley" }));
    expect(mutationMock).toHaveBeenCalledWith({ id: "g1", keep: true });
  });

  it("dismisses without writing a leftover", () => {
    render(<LeftoverProposals />);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss Parsley" }));
    expect(mutationMock).toHaveBeenCalledWith({ id: "g1", keep: false });
  });

  it("offers no bulk answer — each guess is its own question", () => {
    state.proposals = [parsley, { ...parsley, _id: "g2", item: "Buttermilk" }];
    render(<LeftoverProposals />);
    // Two items, two pairs of buttons, and nothing that answers for both.
    expect(screen.getAllByRole("button")).toHaveLength(4);
    expect(screen.queryByRole("button", { name: /all/i })).toBeNull();
  });
});
