import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Button } from "./Button";

describe("Button", () => {
  it("renders a <button> with its children", () => {
    render(<Button>Save</Button>);
    const btn = screen.getByRole("button", { name: "Save" });
    expect(btn.tagName).toBe("BUTTON");
  });

  it("exposes the variant via data-variant (default primary)", () => {
    render(<Button variant="danger">Delete</Button>);
    expect(screen.getByRole("button", { name: "Delete" }).getAttribute("data-variant")).toBe("danger");
    render(<Button>Plain</Button>);
    expect(screen.getByRole("button", { name: "Plain" }).getAttribute("data-variant")).toBe("primary");
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

  it("defaults to type=button and accepts type=submit", () => {
    const { rerender } = render(<Button>Default</Button>);
    expect(screen.getByRole("button").getAttribute("type")).toBe("button");
    rerender(<Button type="submit">Submit</Button>);
    expect(screen.getByRole("button").getAttribute("type")).toBe("submit");
  });
});
