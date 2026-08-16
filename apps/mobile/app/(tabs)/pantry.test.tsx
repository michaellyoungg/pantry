import { render, screen, waitFor } from "@testing-library/react-native";

const DAY = 86_400_000;

// `jest.mock` is hoisted above this file's imports, so the factory may only
// close over names prefixed `mock`.
const mockState = { pantry: [] as unknown[] };
const mockRecommend = jest.fn(async () => ({ results: [], generated: [] }) as unknown);

jest.mock("convex/react", () => {
  const noop = () => Promise.resolve();
  return {
    useQuery: () => mockState.pantry,
    useAction: () => mockRecommend,
    useMutation: () => Object.assign(noop, { withOptimisticUpdate: () => noop }),
  };
});

// The tab navigator renders no header, so the screen reads the top inset
// itself. There is no native safe-area module in a Node test process.
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 44, bottom: 34, left: 0, right: 0 }),
}));

import PantryScreen from "./pantry";

beforeEach(() => {
  jest.clearAllMocks();
  mockState.pantry = [
    {
      _id: "p-spinach",
      _creationTime: 0,
      userId: "u1",
      canonicalItem: "spinach",
      display: "Spinach",
      aisle: "produce",
      state: "have",
      source: "auto",
      updatedAt: 0,
      useBy: Date.now() + 2.5 * DAY,
    },
  ];
});

describe("the pantry route", () => {
  it("is a real screen now, not the placeholder", async () => {
    await render(<PantryScreen />);

    expect(screen.getByTestId("pantry.screen")).toBeOnTheScreen();
    expect(screen.getByTestId("pantry.title")).toHaveTextContent("Pantry");
    expect(screen.queryByTestId("pantry.placeholder")).toBeNull();
    await waitFor(() => expect(mockRecommend).toHaveBeenCalled());
  });

  it("shows inventory and the suggestion card together", async () => {
    await render(<PantryScreen />);

    expect(screen.getByTestId("pantry.use-it-up")).toBeOnTheScreen();
    expect(screen.getByTestId("pantry.item.spinach")).toBeOnTheScreen();
    await waitFor(() => expect(mockRecommend).toHaveBeenCalled());
  });

  it("renders exactly ONE use-it-up surface", async () => {
    // BL-0050 collapsed two competing cards on this route into one. Porting it
    // to a second client is the obvious way to undo that, so the count is
    // asserted rather than assumed.
    await render(<PantryScreen />);

    expect(screen.getAllByTestId("pantry.use-it-up")).toHaveLength(1);
    await waitFor(() => expect(mockRecommend).toHaveBeenCalled());
  });
});
