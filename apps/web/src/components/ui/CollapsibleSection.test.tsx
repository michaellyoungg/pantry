import { TEST_IDS } from "@pantry/core/testing";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CollapsibleSection } from "./CollapsibleSection";

function renderSection(props: Partial<Parameters<typeof CollapsibleSection>[0]> = {}) {
  return render(
    <CollapsibleSection title="Produce" count={3} countLabel="items to buy" {...props}>
      <p>onion</p>
    </CollapsibleSection>,
  );
}

describe("CollapsibleSection", () => {
  it("is open by default — arriving at a folded list would hide the work", () => {
    renderSection();
    expect(screen.getByText("onion")).toBeTruthy();
  });

  it("emits its testId on the section, which stays put as it folds (BL-0071)", () => {
    renderSection({ testId: TEST_IDS.list.inCartSection });
    const section = screen.getByTestId("list.in-cart-section");

    fireEvent.click(screen.getByRole("button", { name: /produce/i }));
    // The contents come and go; the section a selector points at does not.
    expect(screen.getByTestId("list.in-cart-section")).toBe(section);
  });

  it("folds and unfolds on the header", () => {
    renderSection();
    const header = screen.getByRole("button", { name: /produce/i });

    fireEvent.click(header);
    expect(screen.queryByText("onion")).toBeNull();

    fireEvent.click(header);
    expect(screen.getByText("onion")).toBeTruthy();
  });

  it("keeps the count visible when folded, so the section still says how much is left", () => {
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: /produce/i }));
    expect(screen.getByText("3")).toBeTruthy();
  });

  it("spells the count out for a screen reader — 'Produce 3' is a riddle", () => {
    renderSection();
    expect(screen.getByRole("button", { name: "Produce, 3 items to buy" })).toBeTruthy();
  });

  it("reports its folded state", () => {
    renderSection();
    const header = screen.getByRole("button", { name: /produce/i });
    expect(header.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(header);
    expect(header.getAttribute("aria-expanded")).toBe("false");
  });

  it("stays a heading, so the sections are still the outline of the list", () => {
    renderSection();
    expect(screen.getByRole("heading", { name: /produce/i })).toBeTruthy();
  });

  it("can start folded when the caller asks", () => {
    renderSection({ defaultOpen: false });
    expect(screen.queryByText("onion")).toBeNull();
  });

  it("shows a description only while open", () => {
    renderSection({ description: "Checked off already." });
    expect(screen.getByText("Checked off already.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /produce/i }));
    expect(screen.queryByText("Checked off already.")).toBeNull();
  });
});
