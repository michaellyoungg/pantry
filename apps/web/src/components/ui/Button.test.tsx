import { TEST_IDS } from "@pantry/core/testing";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./Button";

describe("Button", () => {
  it("renders a <button> with its children", () => {
    render(<Button>Save</Button>);
    const btn = screen.getByRole("button", { name: "Save" });
    expect(btn.tagName).toBe("BUTTON");
  });

  it("exposes the variant via data-variant (default primary)", () => {
    render(<Button variant="danger">Delete</Button>);
    expect(screen.getByRole("button", { name: "Delete" }).getAttribute("data-variant")).toBe(
      "danger",
    );
    render(<Button>Plain</Button>);
    expect(screen.getByRole("button", { name: "Plain" }).getAttribute("data-variant")).toBe(
      "primary",
    );
  });

  it("forwards onClick and honors disabled", () => {
    const onClick = vi.fn();
    const { rerender } = render(<Button onClick={onClick}>Go</Button>);
    fireEvent.click(screen.getByRole("button", { name: "Go" }));
    expect(onClick).toHaveBeenCalledTimes(1);
    rerender(
      <Button onClick={onClick} disabled>
        Go
      </Button>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Go" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("emits its testId as data-testid, the same string native carries", () => {
    // BL-0071. The value comes from @pantry/core/testing rather than being
    // spelled here: the point of the prop is that both clients read one name.
    render(<Button testId={TEST_IDS.list.doneShopping}>Done shopping</Button>);
    expect(screen.getByTestId("list.done-shopping").textContent).toBe("Done shopping");
  });

  it("stays out of the DOM when no testId is given", () => {
    // Most buttons are reached by role and name, and should keep being — an
    // empty data-testid="" would be a selector that matches nothing.
    render(<Button>Plain</Button>);
    expect(screen.getByRole("button", { name: "Plain" }).hasAttribute("data-testid")).toBe(false);
  });

  it("defaults to type=button and accepts type=submit", () => {
    const { rerender } = render(<Button>Default</Button>);
    expect(screen.getByRole("button").getAttribute("type")).toBe("button");
    rerender(<Button type="submit">Submit</Button>);
    expect(screen.getByRole("button").getAttribute("type")).toBe("submit");
  });
});
