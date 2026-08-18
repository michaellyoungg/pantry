/**
 * The elements both clients render, named once (BL-0071).
 *
 * `testIDs.ts` fixes the *format*; this fixes the *names*. Without it the two
 * clients agree by convention twice — the web spec looks for the grocery line
 * one way, the Maestro flow another, and the day they stop describing the same
 * journey there is no file whose absence says so. This is that file.
 *
 * What belongs here: an element a journey on **both** clients has to reach.
 * What does not: anything only one client draws (the web sidebar has no native
 * counterpart; the native sheet scrims have no web one), and anything a
 * role-based locator already addresses well. Web keeps `getByRole`/`getByLabel`
 * wherever it is working — those assert accessibility as a side effect, which
 * an id cannot, so the migration is deliberately partial. The rule of thumb is
 * that an id names *which thing* ("the garlic line"), and a role names *what
 * you do to it* ("its checkbox").
 *
 * Renaming an entry is a breaking change to two test suites. It belongs in
 * review, not in a drive-by.
 */

import { surfaceTestIDs, type TestID, testIDKey, testIDPrefix } from "./testIDs";

const auth = surfaceTestIDs("auth");
const list = surfaceTestIDs("list");
const pantry = surfaceTestIDs("pantry");
const plan = surfaceTestIDs("plan");
const recipes = surfaceTestIDs("recipes");

export const TEST_IDS = {
  /**
   * Sign-in / sign-up. The one journey every other journey starts with, on both
   * clients — and the one whose locators are pure copy ("Need an account? Sign
   * up"), so text selectors here break on a wording change rather than a
   * behaviour change.
   */
  auth: {
    form: auth("form"),
    email: auth("email"),
    password: auth("password"),
    submit: auth("submit"),
    /** Switches between the sign-in and sign-up flows. */
    toggleFlow: auth("toggle-flow"),
    error: auth("error"),
  },

  /** The grocery list — the shop-floor screen, and the most-driven journey. */
  list: {
    emptyState: list("empty-state"),
    /**
     * One line of the walk, keyed by the ingredient.
     *
     * The web suite used to reach these as `listitem`s; when the leftover
     * prompts and the suggestions card grew lists of their own, naming the same
     * ingredients, every one of those locators started matching two elements —
     * a Playwright strict-mode violation, which is a hard failure rather than
     * something it retries away.
     */
    item: (item: string): TestID => list("item", testIDKey(item)),
    /** Every line at once, for counting them without knowing their names. */
    itemPrefix: testIDPrefix("list", "item"),
    inCartSection: list("in-cart-section"),
    droppedSection: list("dropped-section"),
    /** Reveals the add-an-item field in the thumb zone. */
    addToggle: list("add-toggle"),
    doneShopping: list("done-shopping"),
    clear: list("clear"),
    /**
     * The clear confirmation. A native `Alert`, a web `<dialog>`-alike, and one
     * set of names across both — this is the BL-0026 portable-confirm surface
     * paying off: the flow that clears the list reads the same on either client.
     */
    clearConfirm: {
      dialog: list("confirm-sheet"),
      confirm: list("confirm-clear"),
      cancel: list("confirm-cancel"),
    },
    /** "3 of 8 in cart" — progress through the trip. */
    progress: list("progress"),
    /** The undo offer shown after a line is removed. */
    undo: list("undo"),
    /**
     * Opting into real store prices (BL-0046). Absent from the DOM entirely on
     * a deployment without the feature flag, which is what the "hidden" case in
     * the web suite asserts on.
     */
    storePicker: {
      root: list("store-picker"),
      open: list("store-picker-open"),
      zip: list("store-picker-zip"),
      search: list("store-picker-search"),
      /**
       * One nearby store, keyed by its provider location id.
       *
       * The `id-` prefix is not decoration: a Kroger location id is wholly
       * numeric, and `testIDKey` rejects a bare number as the array-index smell
       * it usually is. The id is the store's real identity — two stores in one
       * search can share a name — so it is prefixed rather than swapped for
       * something less stable.
       */
      store: (locationId: string): TestID =>
        list("store-picker-store", testIDKey(`id-${locationId}`)),
      clear: list("store-picker-clear"),
    },
  },

  /** The pantry inventory. */
  pantry: {
    emptyState: pantry("empty-state"),
    /**
     * One inventory row, keyed by its canonical item — the server's key, not
     * the display form, so the two clients slug the same string.
     */
    item: (canonicalItem: string): TestID => pantry("item", testIDKey(canonicalItem)),
    itemPrefix: testIDPrefix("pantry", "item"),
    /**
     * Flags a row for the recommender to build around. Spelled `markUseUp`
     * rather than `useUp` only because the linter reads a `useX` property as a
     * React hook; the id itself is `pantry.use-up.…`, as on native.
     */
    markUseUp: (canonicalItem: string): TestID => pantry("use-up", testIDKey(canonicalItem)),
  },

  /** The week plan. */
  plan: {
    /** A basket recipe waiting for a day, in the "Not yet planned" rail. */
    unplanned: (title: string): TestID => plan("unplanned", testIDKey(title)),
    /**
     * A meal sitting on a day. Web draws a cell in a seven-column grid, native
     * a card under a day pager, so the shared journey needs one name.
     */
    meal: (title: string): TestID => plan("meal", testIDKey(title)),
    mealPrefix: testIDPrefix("plan", "meal"),
    generate: plan("generate"),
    suggest: plan("suggest"),
    /** Accepts the proposal — the one control in that flow that writes. */
    suggestAccept: plan("suggest-accept"),
  },

  /** The user's own recipes, the catalog, and the kitchen they share a tab with. */
  recipes: {
    /**
     * A row of "My recipes". Named by id rather than by list membership because
     * /recipes renders the same title twice — once here and once in the "For
     * you" panel, which can recommend a recipe you already own.
     *
     * The title is the only identity a spec can name in advance; the recipe's
     * id is server-minted. The app tolerates duplicate titles (and flags them),
     * so two rows can answer to one id — every e2e title is minted with
     * `uniqueSuffix()`, which is what keeps the suite clear of it.
     */
    item: (title: string): TestID => recipes("item", testIDKey(title)),
    itemPrefix: testIDPrefix("recipes", "item"),
    /**
     * Which of the three views is on screen (BL-0063). Web draws them as links
     * in a sub-nav and native as a segmented control, so the journey "browse
     * the catalog" needs one name for the control that gets it there.
     */
    section: (section: "mine" | "catalog" | "kitchen"): TestID => recipes("section", section),
    /** A catalog row, keyed by title for the same reason `item` is. */
    catalogItem: (title: string): TestID => recipes("catalog-item", testIDKey(title)),
    catalogItemPrefix: testIDPrefix("recipes", "catalog-item"),
    /** Clones the catalog recipe into the user's own recipes and baskets it. */
    catalogAdd: (title: string): TestID => recipes("catalog-add", testIDKey(title)),
    catalogSearch: recipes("catalog-search"),
    /** One filter chip. The group is in the key so `diet` and `cuisine` can collide. */
    catalogChip: (group: "time" | "diet" | "cuisine", value: string): TestID =>
      recipes("catalog-chip", `${group}-${testIDKey(value)}`),
    onlyMakeable: recipes("only-makeable"),
    clearFilters: recipes("clear-filters"),
    /** One equipment checkbox in My Kitchen, keyed by its catalog slug. */
    equipment: (equipmentId: string): TestID => recipes("equipment", testIDKey(equipmentId)),
    /** "What can I make?" — opens the unlocks panel for one device. */
    unlocks: (equipmentId: string): TestID => recipes("unlocks", testIDKey(equipmentId)),
    /** The add funnel: the entry point, the URL box, and the save. */
    add: recipes("add"),
    importUrl: recipes("import-url"),
    importSubmit: recipes("import-submit"),
    saveRecipe: recipes("save"),
    /** Opens the edit form for one recipe, and the delete it sits beside. */
    edit: (title: string): TestID => recipes("edit", testIDKey(title)),
    remove: (title: string): TestID => recipes("remove", testIDKey(title)),
  },
} as const;
