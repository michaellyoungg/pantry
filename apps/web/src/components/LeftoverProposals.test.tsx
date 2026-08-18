import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LeftoverProposals } from "./LeftoverProposals";

const onResolve = vi.fn();

const parsley = {
  _id: "g1",
  item: "Parsley",
  quantity: 2,
  unit: "tbsp",
  purchase: { quantity: 1, unit: "bunch", residue: 6, residueUnit: "tbsp" },
};

describe("LeftoverProposals", () => {
  beforeEach(() => vi.clearAllMocks());

  it("says nothing at all when there is nothing to propose", () => {
    const { container } = render(<LeftoverProposals proposals={[]} onResolve={onResolve} />);
    expect(container.textContent).toBe("");
  });

  it("shows its own arithmetic, so the guess is inspectable", () => {
    render(<LeftoverProposals proposals={[parsley]} onResolve={onResolve} />);
    expect(screen.getByText(/6 tbsp of the 1 bunch you bought/)).toBeTruthy();
    expect(screen.getByText(/after the 2 tbsp your recipes wanted/)).toBeTruthy();
  });

  it("confirms one item at a time", () => {
    render(<LeftoverProposals proposals={[parsley]} onResolve={onResolve} />);
    fireEvent.click(screen.getByRole("button", { name: "Keep Parsley" }));
    expect(onResolve).toHaveBeenCalledWith(parsley, true);
  });

  it("dismisses without writing a leftover", () => {
    render(<LeftoverProposals proposals={[parsley]} onResolve={onResolve} />);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss Parsley" }));
    expect(onResolve).toHaveBeenCalledWith(parsley, false);
  });

  it("offers no bulk answer — each guess is its own question", () => {
    const proposals = [parsley, { ...parsley, _id: "g2", item: "Buttermilk" }];
    render(<LeftoverProposals proposals={proposals} onResolve={onResolve} />);
    // Two items, two pairs of buttons, and nothing that answers for both.
    expect(screen.getAllByRole("button")).toHaveLength(4);
    expect(screen.queryByRole("button", { name: /all/i })).toBeNull();
  });
});
