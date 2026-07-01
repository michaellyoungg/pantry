import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
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
