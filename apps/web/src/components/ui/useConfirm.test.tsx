import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { type ConfirmOptions, useConfirm } from "./useConfirm";

function Harness({
  onResult,
  options = { title: "Delete it?" },
}: {
  onResult: (answer: boolean) => void;
  options?: ConfirmOptions;
}) {
  const { confirm, confirmDialog } = useConfirm();
  return (
    <>
      <button type="button" onClick={() => confirm(options).then(onResult)}>
        Ask
      </button>
      {confirmDialog}
    </>
  );
}

describe("useConfirm", () => {
  it("shows no dialog until confirm is called", () => {
    render(<Harness onResult={vi.fn()} />);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("resolves true when the user accepts", async () => {
    const onResult = vi.fn();
    render(<Harness onResult={onResult} />);

    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirm" }));

    await waitFor(() => expect(onResult).toHaveBeenCalledWith(true));
  });

  it("resolves false when the user cancels", async () => {
    const onResult = vi.fn();
    render(<Harness onResult={onResult} />);

    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(onResult).toHaveBeenCalledWith(false));
  });

  it("closes the dialog once the question is answered", async () => {
    render(<Harness onResult={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  });

  it("resolves false when the dialog is dismissed with Escape", async () => {
    const onResult = vi.fn();
    render(<Harness onResult={onResult} />);

    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.keyDown(dialog, { key: "Escape" });

    await waitFor(() => expect(onResult).toHaveBeenCalledWith(false));
  });

  it("renders the supplied title, message and action labels", async () => {
    render(
      <Harness
        onResult={vi.fn()}
        options={{
          title: "Clear the grocery list?",
          message: "Checked lines go too.",
          confirmLabel: "Clear",
          cancelLabel: "Keep it",
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Ask" }));

    expect(await screen.findByText("Clear the grocery list?")).toBeTruthy();
    expect(screen.getByText("Checked lines go too.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Clear" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Keep it" })).toBeTruthy();
  });

  it("labels the dialog with its title for assistive tech", async () => {
    render(<Harness onResult={vi.fn()} options={{ title: "Delete Garlic Bread?" }} />);

    fireEvent.click(screen.getByRole("button", { name: "Ask" }));

    expect(await screen.findByRole("alertdialog", { name: "Delete Garlic Bread?" })).toBeTruthy();
  });

  it("marks the confirm action as destructive when asked", async () => {
    render(<Harness onResult={vi.fn()} options={{ title: "Delete?", destructive: true }} />);

    fireEvent.click(screen.getByRole("button", { name: "Ask" }));

    const confirmButton = await screen.findByRole("button", { name: "Confirm" });
    expect(confirmButton.getAttribute("data-variant")).toBe("danger");
  });

  it("never strands a caller when the asking component unmounts", async () => {
    const onResult = vi.fn();
    const { unmount } = render(<Harness onResult={onResult} />);

    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    await screen.findByRole("alertdialog");
    unmount();

    await waitFor(() => expect(onResult).toHaveBeenCalledWith(false));
  });

  it("never strands a caller when a second question supersedes the first", async () => {
    const onResult = vi.fn();
    render(<Harness onResult={onResult} />);

    const ask = screen.getByRole("button", { name: "Ask" });
    fireEvent.click(ask);
    fireEvent.click(ask);

    await waitFor(() => expect(onResult).toHaveBeenCalledWith(false));
    expect(await screen.findByRole("alertdialog")).toBeTruthy();
  });
});
