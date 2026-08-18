/**
 * The parity guard (BL-0073): the browser suite's journeys, and this client's
 * answer for each of them.
 *
 * `maestroFlows.test.ts` asks whether the flows are internally consistent. This
 * asks the question that outlives any one flow — whether the two suites still
 * describe the same product. A new Playwright spec fails here until somebody
 * has either written the flow or written down why there isn't one, which is the
 * whole difference between a known gap and an unknown one.
 *
 * It reads across apps deliberately. Parity is a claim about a pair, and a
 * check that only ever looked at `apps/mobile` could not make it.
 *
 * @jest-environment-options {"customExportConditions": ["node", "require", "default"]}
 */
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { FLOW_PARITY, NATIVE_ONLY_FLOWS } from "./flowParity";

const MOBILE_ROOT = path.resolve(__dirname, "../..");
const WEB_SPECS = path.resolve(MOBILE_ROOT, "../web/e2e");
const BACKLOG = path.resolve(MOBILE_ROOT, "../../docs/backlog");

/** Journey names, from `apps/web/e2e/<name>.spec.ts`. */
const SPECS = readdirSync(WEB_SPECS)
  .filter((file) => file.endsWith(".spec.ts"))
  .map((file) => file.replace(/\.spec\.ts$/, ""))
  .sort();

/** Journey names, from `apps/mobile/e2e/flows/<name>.yml`. */
const FLOWS = readdirSync(path.join(MOBILE_ROOT, "e2e/flows"))
  .filter((file) => file.endsWith(".yml"))
  .map((file) => file.replace(/\.yml$/, ""))
  .sort();

function hasFlow(journey: string): boolean {
  return existsSync(path.join(MOBILE_ROOT, "e2e/flows", `${journey}.yml`));
}

function backlogItemExists(id: string): boolean {
  return readdirSync(BACKLOG).some((file) => file.startsWith(`${id}-`));
}

describe("flow parity with the browser suite", () => {
  it("finds both suites, so nothing below can pass vacuously", () => {
    expect(SPECS.length).toBeGreaterThan(0);
    expect(FLOWS.length).toBeGreaterThan(0);
  });

  it("has an entry for every browser spec, and none for a spec that is gone", () => {
    // A new spec lands here as an unanswered journey; a deleted one lands here
    // as a stale waiver claiming to excuse something nobody is testing.
    expect(Object.keys(FLOW_PARITY).sort()).toEqual(SPECS);
  });

  it("names every flow after the spec it mirrors", () => {
    const unexplained = FLOWS.filter(
      (flow) => !(flow in FLOW_PARITY) && !(flow in NATIVE_ONLY_FLOWS),
    );

    expect(unexplained).toEqual([]);
  });

  it("backs every covered and partial journey with a flow file", () => {
    const missingFile = Object.entries(FLOW_PARITY)
      .filter(([journey, parity]) => parity.state !== "gap" && !hasFlow(journey))
      .map(([journey]) => journey);

    expect(missingFile).toEqual([]);
  });

  it("keeps no waiver for a journey that is now covered", () => {
    // A flow written without clearing its `gap` entry leaves the manifest
    // claiming less coverage than the suite has, which is the direction that
    // quietly stops anyone from asking for the rest of it.
    const stale = Object.entries(FLOW_PARITY)
      .filter(([journey, parity]) => parity.state === "gap" && hasFlow(journey))
      .map(([journey]) => journey);

    expect(stale).toEqual([]);
  });

  it("says what is missing, and points any blocker at a real backlog item", () => {
    // `blockedBy` is optional, because an unowned gap is a legitimate thing to
    // record and naming an item that does not cover it would be worse. What is
    // not optional is saying what is missing — and a blocker that names nothing
    // is the stale waiver this whole file exists to prevent.
    for (const [journey, parity] of Object.entries(FLOW_PARITY)) {
      if (parity.state === "covered") continue;

      expect({ journey, explained: parity.missing.length > 0 }).toEqual({
        journey,
        explained: true,
      });
      if (parity.blockedBy === undefined) continue;
      expect({
        journey,
        blockedBy: parity.blockedBy,
        exists: backlogItemExists(parity.blockedBy),
      }).toEqual({ journey, blockedBy: parity.blockedBy, exists: true });
    }
  });

  it("explains every native-only flow", () => {
    for (const [flow, reason] of Object.entries(NATIVE_ONLY_FLOWS)) {
      expect({ flow, hasFile: FLOWS.includes(flow) }).toEqual({ flow, hasFile: true });
      expect(reason.length).toBeGreaterThan(0);
    }
  });
});
