/**
 * Guards the expo-router route tree against files that must not be bundled.
 *
 * `expo-router/entry` enumerates routes with
 *
 *     require.context(EXPO_ROUTER_APP_ROOT, true,
 *       /^(?:\.\/)(?!(?:(?:(?:.*\+api)|(?:\+html)))\.[tj]sx?$).*\.[tj]sx?$/)
 *
 * — the only exclusions are `+api` and `+html`. **Every other `.ts`/`.tsx` file
 * under `app/` is compiled into the app bundle**, and is registered as a route
 * besides.
 *
 * That makes a colocated test file uniquely destructive here. `app/(tabs)/
 * pantry.test.tsx` imported `@testing-library/react-native`, which requires
 * Node's `console` and `util`; Metro cannot resolve those for React Native, so
 * bundling failed with `Unable to resolve module console` and `expo start`
 * served a 500 for the whole client — not just that one screen.
 *
 * Nothing else caught it. Jest passes (it is a valid test), `tsc` passes (the
 * imports type-check), and the mobile e2e harness is nightly rather than a
 * merge gate (BL-0072), so the break reached main green.
 *
 * Screen tests belong in `src/`, importing the route module across the
 * boundary — see `src/pantry/PantryScreen.test.tsx`.
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";

const APP_ROOT = join(__dirname, "..", "..", "app");

/** Every file under `app/`, as paths relative to `app/`. */
function routeTreeFiles(dir = APP_ROOT, prefix = ""): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    return entry.isDirectory() ? routeTreeFiles(join(dir, entry.name), rel) : [rel];
  });
}

/** Mirrors the shapes Jest itself collects, so the two cannot disagree. */
const TEST_FILE = /(\.(test|spec)\.[tj]sx?$)|(^|\/)__tests__(\/|$)/;

describe("the expo-router route tree", () => {
  it("contains no test files", () => {
    const offenders = routeTreeFiles().filter((file) => TEST_FILE.test(file));

    expect(offenders).toEqual([]);
  });

  it("is not empty, so the check above cannot pass vacuously", () => {
    expect(routeTreeFiles().length).toBeGreaterThan(0);
  });
});
