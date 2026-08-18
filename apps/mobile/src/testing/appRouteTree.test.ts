/**
 * expo-router bundles every `.ts`/`.tsx` under `app/` except `+api`/`+html`, so a
 * colocated test drags `@testing-library/react-native` into the native bundle and
 * `expo start` 500s for the whole client. Screen tests live in `src/`.
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
