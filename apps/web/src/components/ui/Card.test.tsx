import { TEST_IDS } from "@pantry/core/testing";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Card } from "./Card";

describe("Card", () => {
  it("renders its title as a heading and its children", () => {
    render(
      <Card title="Recipes">
        <p>hello</p>
      </Card>,
    );
    expect(screen.getByRole("heading", { name: "Recipes" })).toBeTruthy();
    expect(screen.getByText("hello")).toBeTruthy();
  });

  it("emits its testId as data-testid (BL-0071)", () => {
    render(
      <Card testId={TEST_IDS.list.inCartSection}>
        <p>body</p>
      </Card>,
    );
    expect(screen.getByTestId("list.in-cart-section")).toBeTruthy();
  });

  it("omits the heading when no title is given", () => {
    render(
      <Card>
        <p>body</p>
      </Card>,
    );
    expect(screen.queryByRole("heading")).toBeNull();
    expect(screen.getByText("body")).toBeTruthy();
  });
});
