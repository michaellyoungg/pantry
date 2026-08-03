import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProvenanceButton, ProvenanceSheet } from "./GroceryProvenance";

// The sheet links through to a recipe, so it needs a router. Stub Link to the
// anchor it renders: what matters here is the destination, not TanStack's
// matching, which the router's own tests cover.
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    search,
    children,
    ...props
  }: {
    to: string;
    search?: Record<string, string>;
    children: React.ReactNode;
  }) => (
    <a href={`${to}?${new URLSearchParams(search ?? {}).toString()}`} {...props}>
      {children}
    </a>
  ),
}));

const sources = [
  { recipeId: "r1", title: "Chili", quantity: 0.25 },
  { recipeId: "r2", title: "Toast", quantity: 0.5 },
];

describe("ProvenanceButton", () => {
  it("says how many recipes wanted the line", () => {
    render(<ProvenanceButton sources={sources} onOpen={() => {}} />);
    expect(screen.getByRole("button", { name: /2 recipes/i })).toBeTruthy();
  });

  it("says recipe, singular, for one", () => {
    render(<ProvenanceButton sources={[sources[0]]} onOpen={() => {}} />);
    expect(screen.getByRole("button", { name: /1 recipe\b/i })).toBeTruthy();
  });

  it("shows nothing for a line with no traceable source", () => {
    const { container } = render(<ProvenanceButton sources={undefined} onOpen={() => {}} />);
    expect(container.innerHTML).toBe("");
  });

  it("shows nothing rather than an empty sheet for an empty source list", () => {
    const { container } = render(<ProvenanceButton sources={[]} onOpen={() => {}} />);
    expect(container.innerHTML).toBe("");
  });
});

describe("ProvenanceSheet", () => {
  it("lists each contributing recipe with its amount in the line's unit", () => {
    render(<ProvenanceSheet item="Butter" unit="cup" sources={sources} onClose={() => {}} />);
    // ¼ + ½ are what the line's ¾ is made of — the point of the sheet.
    expect(screen.getByText("¼ cup")).toBeTruthy();
    expect(screen.getByText("½ cup")).toBeTruthy();
  });

  it("links each recipe through to the recipes page opened on it", () => {
    render(<ProvenanceSheet item="Butter" unit="cup" sources={sources} onClose={() => {}} />);
    expect(screen.getByRole("link", { name: "Chili" }).getAttribute("href")).toBe(
      "/recipes?recipe=r1",
    );
  });

  it("omits the unit for a counted item", () => {
    render(
      <ProvenanceSheet
        item="Eggs"
        unit=""
        sources={[{ recipeId: "r1", title: "Omelette", quantity: 3 }]}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText("3")).toBeTruthy();
  });

  it("closes on the Close button", () => {
    const onClose = vi.fn();
    render(<ProvenanceSheet item="Butter" unit="cup" sources={sources} onClose={onClose} />);
    screen.getByRole("button", { name: "Close" }).click();
    expect(onClose).toHaveBeenCalled();
  });

  it("closes when a recipe is followed, so the list is not left behind a sheet", () => {
    const onClose = vi.fn();
    render(<ProvenanceSheet item="Butter" unit="cup" sources={sources} onClose={onClose} />);
    screen.getByRole("link", { name: "Chili" }).click();
    expect(onClose).toHaveBeenCalled();
  });

  it("is a labelled modal dialog", () => {
    render(<ProvenanceSheet item="Butter" unit="cup" sources={sources} onClose={() => {}} />);
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(screen.getByRole("heading", { name: "Butter" })).toBeTruthy();
  });
});
