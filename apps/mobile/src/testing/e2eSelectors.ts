/**
 * Every selector `apps/mobile/e2e` taps or asserts on, in TypeScript.
 *
 * The flows are YAML: nothing typechecks them, so `tapOn: {id: "auth.sumbit"}`
 * is a valid flow file that fails at 3am with "element not found". This module
 * is what makes that checkable. `maestroFlows.test.ts` refuses an id in a flow
 * that is not listed here; `e2eSelectors.test.tsx` renders the surfaces and
 * refuses an id listed here that the app no longer emits.
 *
 * Not a copy of `TEST_IDS` — that names what both clients render, this names
 * the smaller set the flows drive — but it draws from it wherever an entry
 * exists, so a flow and the Playwright spec for the same journey reach the same
 * element by construction (BL-0071).
 */

import { TEST_IDS } from "@pantry/core/testing";
import { tabTestID } from "../navigation/navItems";
import { type TestID, testID, testIDKey } from "./testIDs";

/**
 * The recipes the flows put in front of themselves, and the ingredients that
 * make their ids predictable.
 *
 * A flow may only name a row it caused to exist. Everything a run finds already
 * there — an aggregated line from a week the ranker proposed, a suggestion from
 * the catalog — is named by data no flow decided, so `list.item.<x>` for one of
 * those would be a bet rather than a selector.
 *
 * The ingredients are chosen to survive the round trip. `garlic` and `baguette`
 * are canonical items in the normalization dictionary, so the server hands back
 * "Garlic" and "Baguette", which slug to the same keys the flows already hold;
 * an unrecognised word would keep whatever was typed. `frozen chicken breast`
 * is the exception and is meant to be: the modifier is what the thaw rule fires
 * on, and the line it produces is deliberately not named by any flow.
 *
 * `maestroFlows.test.ts` pins the titles and ingredients the flows actually
 * type to this table, so the two cannot drift apart.
 */
export const E2E_RECIPES = {
  /** Authored by a flow, through the add funnel (BL-0063). */
  authored: {
    garlicBread: { title: "E2E Garlic Bread", ingredient: "garlic" },
    /** A second recipe calling for the same thing, so a line has two sources. */
    garlicToast: { title: "E2E Garlic Toast", ingredient: "garlic" },
    thawTest: { title: "E2E Thaw Test", ingredient: "frozen chicken breast" },
  },
  /**
   * Seeded by `scripts/lib/e2e-stack.sh`, not authored. `baguette` appears in
   * no recipe any flow writes, so a grocery line bearing it can only have come
   * from the catalog copy of this recipe — which is the whole point of the
   * catalog journey.
   */
  catalog: {
    garlicBread: { title: "Garlic Bread", catalogOnlyIngredient: "baguette" },
    /** A catalog recipe with garlic in it, so the ranker has one to offer. */
    aglioEOlio: { title: "Spaghetti Aglio e Olio" },
  },
} as const;

/** The one line a flow types by hand rather than planning into existence. */
export const E2E_MANUAL_ITEM = "garlic";

const authored = E2E_RECIPES.authored;
const catalog = E2E_RECIPES.catalog;

export const E2E_SELECTORS = {
  auth: {
    form: TEST_IDS.auth.form,
    email: TEST_IDS.auth.email,
    password: TEST_IDS.auth.password,
    submit: TEST_IDS.auth.submit,
    toggleFlow: TEST_IDS.auth.toggleFlow,
  },

  /**
   * Tab bar buttons — also the only "we are signed in" signal a flow has, since
   * the bar is inside `<Authenticated>`.
   */
  nav: {
    homeTab: tabTestID("index"),
    planTab: tabTestID("plan"),
    recipesTab: tabTestID("recipes"),
    listTab: tabTestID("list"),
    pantryTab: tabTestID("pantry"),
    settingsTab: tabTestID("settings"),
  },

  /** Home's state machine: four of its five states have their own element. */
  home: {
    gettingStarted: testID("home", "getting-started"),
    /** Offered by "empty" and again by "shopped", which is what closes the loop. */
    planWeek: testID("home", "plan-week"),
    buildList: testID("home", "build-list"),
    shop: testID("home", "shop"),
    /** Renders only when lead-time prep is actually due (BL-0042). */
    beforeYouCook: testID("home", "before-you-cook"),
  },

  /** The add funnel, the collection, and the catalog they share a tab with. */
  recipes: {
    add: TEST_IDS.recipes.add,
    editor: testID("recipes", "editor"),
    fieldTitle: testID("recipes", "field-title"),
    /** The blank row the editor always shows, so there is somewhere to type. */
    fieldIngredient: testID("recipes", "field-ingredient-item", "row-1"),
    save: TEST_IDS.recipes.saveRecipe,
    /** Where `save` lands: back on the collection, with the new row in it. */
    mine: testID("recipes", "mine"),
    basket: {
      garlicBread: testID("recipes", "basket", testIDKey(authored.garlicBread.title)),
      garlicToast: testID("recipes", "basket", testIDKey(authored.garlicToast.title)),
      thawTest: testID("recipes", "basket", testIDKey(authored.thawTest.title)),
    },
    catalogSection: TEST_IDS.recipes.section("catalog"),
    catalogSearch: TEST_IDS.recipes.catalogSearch,
    catalogItem: TEST_IDS.recipes.catalogItem(catalog.garlicBread.title),
    catalogAdd: TEST_IDS.recipes.catalogAdd(catalog.garlicBread.title),
  },

  /**
   * The planner. `screen` is the navigation assertion and stops at the root:
   * what it proves is that the tab routes, not what the planner draws.
   */
  plan: {
    screen: testID("plan", "screen"),
    /**
     * The heading. Not asserted on for its own sake — it is the anchor a flow
     * scrolls back UP to, because it is the one element on this screen that is
     * always present and always at the top.
     */
    title: testID("plan", "title"),
    /** The selected day with nothing on it — the "was anything written" signal. */
    dayEmpty: testID("plan", "day-empty"),
    generate: TEST_IDS.plan.generate,
    /** "Plan for <day>" on a basket row that has no day yet. */
    schedule: {
      garlicBread: testID("plan", "rail-schedule", testIDKey(authored.garlicBread.title)),
      garlicToast: testID("plan", "rail-schedule", testIDKey(authored.garlicToast.title)),
      thawTest: testID("plan", "rail-schedule", testIDKey(authored.thawTest.title)),
      catalogBread: testID("plan", "rail-schedule", testIDKey(catalog.garlicBread.title)),
    },
    /** The same recipe once it is sitting on a day — the write having landed. */
    meal: {
      garlicBread: TEST_IDS.plan.meal(authored.garlicBread.title),
      garlicToast: TEST_IDS.plan.meal(authored.garlicToast.title),
      thawTest: TEST_IDS.plan.meal(authored.thawTest.title),
      catalogBread: TEST_IDS.plan.meal(catalog.garlicBread.title),
    },
    /** The lead-time badge on a planned meal. */
    prep: testID("plan", "prep", testIDKey(authored.thawTest.title)),
    suggest: TEST_IDS.plan.suggest,
    /** "nothing is saved until you add it" — a proposal exists. */
    suggestPreamble: testID("plan", "suggest-preamble"),
    suggestAccept: TEST_IDS.plan.suggestAccept,
    /** Every day already planned, so there is nothing left to propose. */
    suggestEmpty: testID("plan", "suggest-empty"),
  },

  /** The grocery list. */
  list: {
    emptyState: TEST_IDS.list.emptyState,
    /** The line every planned recipe above puts on the list. */
    garlic: TEST_IDS.list.item(E2E_MANUAL_ITEM),
    garlicToggle: testID("list", "toggle", testIDKey(E2E_MANUAL_ITEM)),
    garlicRemove: testID("list", "remove", testIDKey(E2E_MANUAL_ITEM)),
    garlicProvenance: testID("list", "provenance", testIDKey(E2E_MANUAL_ITEM)),
    /** The line only the catalog's copy of a recipe can have produced. */
    baguette: TEST_IDS.list.item(catalog.garlicBread.catalogOnlyIngredient),
    baguetteProvenance: testID(
      "list",
      "provenance",
      testIDKey(catalog.garlicBread.catalogOnlyIngredient),
    ),
    provenanceSheet: testID("list", "provenance-sheet"),
    provenanceClose: testID("list", "provenance-close"),
    source: {
      garlicBread: testID("list", "provenance-source", testIDKey(authored.garlicBread.title)),
      garlicToast: testID("list", "provenance-source", testIDKey(authored.garlicToast.title)),
      catalogBread: testID("list", "provenance-source", testIDKey(catalog.garlicBread.title)),
    },
    inCartSection: TEST_IDS.list.inCartSection,
    progress: TEST_IDS.list.progress,
    addToggle: TEST_IDS.list.addToggle,
    addField: testID("list", "add-field"),
    addSubmit: testID("list", "add-submit"),
    doneShopping: TEST_IDS.list.doneShopping,
    finishSheet: testID("list", "finish-sheet"),
    finishKeep: testID("list", "finish-keep"),
    undo: TEST_IDS.list.undo,
    undoButton: testID("list", "undo-button"),
  },

  /** The pantry: the inflow's destination, and the "use it up" surface. */
  pantry: {
    garlic: TEST_IDS.pantry.item(E2E_MANUAL_ITEM),
    markUseUp: TEST_IDS.pantry.markUseUp(E2E_MANUAL_ITEM),
    useItUp: testID("pantry", "use-it-up"),
    suggestion: {
      /** The flow's own recipe, never basketed, so it stays a candidate. */
      garlicToast: testID("pantry", "suggestion", testIDKey(authored.garlicToast.title)),
      /** And the catalog half of the same candidate pool. */
      aglioEOlio: testID("pantry", "suggestion", testIDKey(catalog.aglioEOlio.title)),
    },
  },

  /** Sign-out lives on Settings ahead of the rest of that screen (BL-0066). */
  settings: { signOut: testID("settings", "sign-out") },
} as const;

/**
 * Flattened, for the flow-parity assertions. Recursive, because the keyed
 * entries above are grouped by what they name rather than listed flat — one
 * long list of `garlicBreadSchedule`-style keys reads as noise.
 */
function idsIn(node: object): TestID[] {
  return Object.values(node).flatMap((value) =>
    typeof value === "string" ? [value as TestID] : idsIn(value as object),
  );
}

export const E2E_SELECTOR_IDS: readonly TestID[] = idsIn(E2E_SELECTORS);
