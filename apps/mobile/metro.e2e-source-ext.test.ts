/**
 * The seam has no consumer yet, so nothing else in the repo would notice if it
 * stopped working — which is the whole reason to assert it here.
 */
import {
  applyE2ESourceExts,
  E2E_ENV_FLAG,
  e2eSourceExts,
  isE2EBuild,
} from "./metro.e2e-source-ext";

const SOURCE_EXTS = ["ts", "tsx", "js", "jsx"];
const ON = { [E2E_ENV_FLAG]: "1" };

describe("isE2EBuild", () => {
  it("is off unless the flag is exactly 1", () => {
    expect(isE2EBuild({})).toBe(false);
    // "0" and "false" are the two ways someone tries to turn a flag off, and
    // both would otherwise read as truthy.
    expect(isE2EBuild({ [E2E_ENV_FLAG]: "0" })).toBe(false);
    expect(isE2EBuild({ [E2E_ENV_FLAG]: "false" })).toBe(false);
    expect(isE2EBuild({ [E2E_ENV_FLAG]: "" })).toBe(false);
  });

  it("is on for the flag the runner sets", () => {
    expect(isE2EBuild(ON)).toBe(true);
  });
});

describe("e2eSourceExts", () => {
  it("leaves a normal build's extensions exactly as they were", () => {
    expect(e2eSourceExts(SOURCE_EXTS, {})).toBe(SOURCE_EXTS);
  });

  it("puts every e2e extension ahead of every plain one", () => {
    const exts = e2eSourceExts(SOURCE_EXTS, ON);

    expect(exts).toEqual(["e2e.ts", "e2e.tsx", "e2e.js", "e2e.jsx", "ts", "tsx", "js", "jsx"]);
  });

  it("does not interleave, so a .tsx module's .e2e.tsx twin still wins", () => {
    const exts = e2eSourceExts(SOURCE_EXTS, ON);
    const lastE2E = exts.findLastIndex((ext) => ext.startsWith("e2e."));
    const firstPlain = exts.findIndex((ext) => !ext.startsWith("e2e."));

    expect(lastE2E).toBeLessThan(firstPlain);
  });

  it("covers whatever Expo configured rather than a hand-kept list", () => {
    expect(e2eSourceExts(["mjs", "cjs"], ON)).toEqual(["e2e.mjs", "e2e.cjs", "mjs", "cjs"]);
  });

  it("does not mutate the list Metro handed it", () => {
    const original = [...SOURCE_EXTS];

    e2eSourceExts(SOURCE_EXTS, ON);

    expect(SOURCE_EXTS).toEqual(original);
  });
});

describe("applyE2ESourceExts", () => {
  const config = () => ({
    projectRoot: "/repo/apps/mobile",
    resolver: { sourceExts: [...SOURCE_EXTS], unstable_enableSymlinks: true },
  });

  // The banner is deliberate in Metro and noise in a Jest report.
  let log: jest.SpyInstance;
  beforeEach(() => {
    log = jest.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => log.mockRestore());

  it("leaves a normal build's config alone", () => {
    const input = config();

    expect(applyE2ESourceExts(input, {})).toBe(input);
    expect(input.resolver.sourceExts).toEqual(SOURCE_EXTS);
  });

  it("keeps the same config object, so other Metro wrappers are not dropped", () => {
    const input = config();

    expect(applyE2ESourceExts(input, ON)).toBe(input);
  });

  it("replaces only sourceExts, keeping the rest of the resolver", () => {
    const applied = applyE2ESourceExts(config(), ON);

    expect(applied.resolver.sourceExts[0]).toBe("e2e.ts");
    expect(applied.resolver.unstable_enableSymlinks).toBe(true);
    expect(applied.projectRoot).toBe("/repo/apps/mobile");
  });

  it("announces itself, so a stray flag is findable in the Metro banner", () => {
    applyE2ESourceExts(config(), ON);

    expect(log).toHaveBeenCalledWith(expect.stringContaining(E2E_ENV_FLAG));
  });
});
