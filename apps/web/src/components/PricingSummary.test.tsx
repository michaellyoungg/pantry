import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { actionMock, storeMock } = vi.hoisted(() => ({
  actionMock: vi.fn(),
  storeMock: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useAction: () => actionMock,
  useQuery: () => storeMock(),
}));

// The store chooser runs its own action, query and mutations, and has its own
// suite; stubbing it keeps this file about the bill.
vi.mock("./StorePicker", () => ({
  StorePicker: () => <div data-testid="store-picker" />,
}));

import { formatCents, formatObservationMonth, PricingSummary, storeLabel } from "./PricingSummary";

const line = { canonicalItem: "eggs", item: "Eggs", unit: "", quantity: 12 };

function estimate(over: Record<string, unknown> = {}) {
  return {
    currency: "USD",
    totalCents: 4712,
    pricedCount: 15,
    unpricedCount: 0,
    lines: [],
    basis: {
      source: "U.S. Bureau of Labor Statistics",
      sourceUrl: "https://www.bls.gov/cpi/data.htm",
      area: "U.S. city average",
      observationMonth: "2026-06",
      staleness: "fresh",
    },
    ...over,
  };
}

describe("PricingSummary", () => {
  beforeEach(() => {
    actionMock.mockReset();
    actionMock.mockResolvedValue(estimate());
    storeMock.mockReset();
    // No store chosen is the default, and every assertion below is what a user
    // who never opts in still sees.
    storeMock.mockReturnValue(null);
  });

  it("renders nothing when the list is empty", () => {
    const { container } = render(<PricingSummary lines={[]} />);
    expect(container.textContent).toBe("");
  });

  it("shows the total with its basis and vintage", async () => {
    render(<PricingSummary lines={[line]} />);
    await waitFor(() => expect(screen.getByText(/≈\$47\.12/)).toBeTruthy());
    expect(screen.getByText(/U\.S\. city average averages, Jun 2026/)).toBeTruthy();
  });

  it("says how many items the total does not cover", async () => {
    actionMock.mockResolvedValue(estimate({ pricedCount: 15, unpricedCount: 3 }));
    render(<PricingSummary lines={[line]} />);
    await waitFor(() => expect(screen.getByText(/3 of 18 items not estimated/)).toBeTruthy());
  });

  it("omits the unpriced note when everything was priced", async () => {
    render(<PricingSummary lines={[line]} />);
    await waitFor(() => expect(screen.getByText(/≈\$47\.12/)).toBeTruthy());
    expect(screen.queryByText(/not estimated/)).toBeNull();
  });

  it("warns when the price table has gone stale", async () => {
    actionMock.mockResolvedValue(estimate({ basis: { ...estimate().basis, staleness: "stale" } }));
    render(<PricingSummary lines={[line]} />);
    await waitFor(() => expect(screen.getByText(/may be out of date/)).toBeTruthy());
  });

  it("does not warn when the price table is fresh", async () => {
    render(<PricingSummary lines={[line]} />);
    await waitFor(() => expect(screen.getByText(/≈\$47\.12/)).toBeTruthy());
    expect(screen.queryByText(/may be out of date/)).toBeNull();
  });

  it("surfaces an error without hiding the rest of the list", async () => {
    actionMock.mockRejectedValue(new Error("recipe-service unreachable"));
    render(<PricingSummary lines={[line]} />);
    await waitFor(() => expect(screen.getByText(/Could not estimate a cost/)).toBeTruthy());
  });

  it("shows a loading state while the estimate is in flight", () => {
    actionMock.mockReturnValue(new Promise(() => {}));
    render(<PricingSummary lines={[line]} />);
    expect(screen.getByText(/Estimating cost/)).toBeTruthy();
  });

  it("re-estimates when a quantity changes", async () => {
    const { rerender } = render(<PricingSummary lines={[line]} />);
    await waitFor(() => expect(actionMock).toHaveBeenCalledTimes(1));
    rerender(<PricingSummary lines={[{ ...line, quantity: 24 }]} />);
    await waitFor(() => expect(actionMock).toHaveBeenCalledTimes(2));
  });

  it("re-estimates when a line is flagged already-have", async () => {
    const { rerender } = render(<PricingSummary lines={[line]} />);
    await waitFor(() => expect(actionMock).toHaveBeenCalledTimes(1));
    rerender(<PricingSummary lines={[{ ...line, alreadyHave: true }]} />);
    await waitFor(() => expect(actionMock).toHaveBeenCalledTimes(2));
  });

  // BL-0046. A store changes where every price comes from, so it belongs in the
  // signature exactly as quantities do.
  it("re-estimates when the chosen store changes", async () => {
    const { rerender } = render(<PricingSummary lines={[line]} />);
    await waitFor(() => expect(actionMock).toHaveBeenCalledTimes(1));

    storeMock.mockReturnValue({ provider: "kroger", locationId: "01400376", name: "Corryville" });
    rerender(<PricingSummary lines={[line]} />);
    await waitFor(() => expect(actionMock).toHaveBeenCalledTimes(2));
  });

  it("names the store and how much of the list it covered", async () => {
    actionMock.mockResolvedValue(
      estimate({
        pricedCount: 15,
        unpricedCount: 0,
        basis: {
          ...estimate().basis,
          store: {
            provider: "kroger",
            locationId: "01400376",
            storeName: "Corryville",
            fetchedAt: "2026-08-17T12:00:00Z",
            pricedCount: 9,
          },
        },
      }),
    );
    render(<PricingSummary lines={[line]} />);

    // A mixed total must not imply one accuracy throughout: six of these lines
    // are still national averages, and the line above says so.
    await waitFor(() => expect(screen.getByText(/9 of 15 priced at Corryville/)).toBeTruthy());
    expect(screen.getByText(/the rest from U\.S\. city average averages, Jun 2026/)).toBeTruthy();
  });

  it("does not call BLS vintage stale when the shelf priced the list", async () => {
    actionMock.mockResolvedValue(
      estimate({
        basis: {
          ...estimate().basis,
          staleness: "stale",
          store: {
            provider: "kroger",
            locationId: "01400376",
            storeName: "Corryville",
            fetchedAt: "2026-08-17T12:00:00Z",
            pricedCount: 15,
          },
        },
      }),
    );
    render(<PricingSummary lines={[line]} />);

    await waitFor(() => expect(screen.getByText(/priced at Corryville/)).toBeTruthy());
    expect(screen.queryByText(/may be out of date/)).toBeNull();
  });
});

describe("storeLabel", () => {
  it("prefers the store's own name", () => {
    expect(storeLabel({ provider: "kroger", storeName: "Corryville" })).toBe("Corryville");
  });

  it("falls back to the provider rather than showing a blank", () => {
    expect(storeLabel({ provider: "kroger" })).toBe("kroger");
    expect(storeLabel({ provider: "kroger", storeName: "" })).toBe("kroger");
  });
});

describe("formatObservationMonth", () => {
  it("renders a friendly month", () => {
    expect(formatObservationMonth("2026-06")).toBe("Jun 2026");
    expect(formatObservationMonth("2026-01")).toBe("Jan 2026");
  });

  it("falls back to the raw stamp rather than showing nothing", () => {
    expect(formatObservationMonth("garbage")).toBe("garbage");
    expect(formatObservationMonth("2026-13")).toBe("2026-13");
  });
});

describe("formatCents", () => {
  it("formats whole and fractional dollars", () => {
    expect(formatCents(4712)).toBe("$47.12");
    expect(formatCents(0)).toBe("$0.00");
    expect(formatCents(5)).toBe("$0.05");
  });
});
