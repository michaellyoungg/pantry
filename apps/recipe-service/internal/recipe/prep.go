package recipe

import (
	"regexp"
	"sort"
	"strings"
	"time"
)

// isoDate is how every date crosses the wire in this feature. Prep is scheduled
// by day, never by clock time, and a bare date carries no timezone to get wrong
// on the way to a client in another one.
const isoDate = "2006-01-02"

// PrepSource is which producer emitted a task. Only "rule" exists today;
// BL-0044 adds "llm" and "manual" and merges all three by Key, precedence
// manual > llm > rule. The field ships now so that merge needs no migration and
// no change to this wire shape.
const PrepSourceRule = "rule"

// PrepTask is one piece of lead-time work for one meal on one date.
type PrepTask struct {
	// Key is stable across re-derivation: ruleID + ":" + subject. Check-off is
	// stored against it, so editing a rule's *text* preserves the tick while
	// changing a rule's *id* deliberately does not — a redefined rule is a new
	// task, and silently carrying state across a redefinition is worse than one
	// checkbox reappearing.
	Key string `json:"key"`
	// RuleID and Subject are the two halves of Key, carried separately so a
	// client can group or explain a task without parsing the key back apart.
	RuleID  string `json:"ruleId"`
	Subject string `json:"subject"`
	// Window is the relative bucket; DueOn is that bucket resolved against the
	// cook date. DueOn is what a notification would fire on, and what "missed"
	// is judged against.
	Window PrepWindow `json:"window"`
	Text   string     `json:"text"`
	Source string     `json:"source"`
	DueOn  string     `json:"dueOn"`
	// Missed is set by MarkMissed when the caller supplies today's date: the
	// due date is already in the past. A missed task is still returned — the
	// whole point of the feature is lead time, and silently dropping the task
	// you forgot is how "take the chicken out tonight" becomes "why is dinner
	// frozen".
	Missed bool `json:"missed,omitempty"`
}

// prepStates is the canonical ingredient-state vocabulary rules may key on.
// It is closed for the same reason the method enum is: a rule cannot be written
// against a vocabulary that varies per recipe.
var prepStates = map[string]bool{
	"frozen":           true,
	"softened":         true,
	"room_temperature": true,
	"dried":            true,
}

// prepStateAliases maps the words that actually appear in ingredient lines onto
// that vocabulary. "frozen peas, thawed" and "frozen peas" are the same signal:
// either way something has to come out of the freezer the night before. The
// phrases are matched on word boundaries against the item text and its note.
//
// Words that read as a state but are not one are deliberately absent — "dry" is
// "dry white wine" and "patted dry" far more often than it is a dried bean, and
// a rule that fires on the wrong ingredient is worse than one that stays quiet.
var prepStateAliases = []struct {
	re    *regexp.Regexp
	state string
}{
	{regexp.MustCompile(`\bfrozen\b`), "frozen"},
	{regexp.MustCompile(`\bthawed\b`), "frozen"},
	{regexp.MustCompile(`\bdefrosted\b`), "frozen"},
	{regexp.MustCompile(`\bsoftened\b`), "softened"},
	{regexp.MustCompile(`\broom temperature\b`), "room_temperature"},
	{regexp.MustCompile(`\broom temp\b`), "room_temperature"},
	{regexp.MustCompile(`\bdried\b`), "dried"},
}

// ingredientStates returns the canonical states an ingredient line asserts.
// Both the item text and the note are read: "frozen peas" puts the state in the
// item, "peas, thawed" puts it in the note, and neither placement is more
// correct than the other in real recipe text.
func ingredientStates(ing Ingredient) map[string]bool {
	hay := strings.ToLower(ing.Item + " " + ing.Note)
	out := map[string]bool{}
	for _, a := range prepStateAliases {
		if a.re.MatchString(hay) {
			out[a.state] = true
		}
	}
	return out
}

// stripStateWords removes recognized state words from item text: "frozen
// chicken breast" is a chicken breast, and the normalizer's table is keyed on
// ingredients, not on the condition they arrive in. Returns "" when nothing was
// removed.
func stripStateWords(item string) string {
	out := strings.ToLower(item)
	changed := false
	for _, a := range prepStateAliases {
		if a.re.MatchString(out) {
			out = a.re.ReplaceAllString(out, " ")
			changed = true
		}
	}
	if !changed {
		return ""
	}
	return strings.Join(strings.Fields(out), " ")
}

// prepItemDetails canonicalizes an ingredient for rule matching.
//
// The literal text is tried first and only a genuinely unrecognized item is
// retried with its state words stripped. Order matters: "frozen spinach" is its
// own entry in the dataset — a frozen-aisle item with its own shelf life — and
// stripping first would quietly turn it into fresh spinach from produce.
func prepItemDetails(item string) ItemDetails {
	d := normalizer.Details(item)
	if d.Known {
		return d
	}
	if stripped := stripStateWords(item); stripped != "" {
		if d2 := normalizer.Details(stripped); d2.Known {
			return d2
		}
	}
	return d
}

// quantityLb converts an ingredient's quantity to pounds. ok is false for
// anything not measured by mass — a count ("2 chicken breasts") or a volume —
// which means a min-quantity rule never fires on an unmeasurable line rather
// than guessing a weight for it.
func quantityLb(ing Ingredient) (float64, bool) {
	dim, toBase, ok := normalizer.Unit(ing.Unit)
	if !ok || dim != "mass" || ing.Quantity <= 0 {
		return 0, false
	}
	const gramsPerLb = 453.592
	return ing.Quantity * toBase / gramsPerLb, true
}

// candidate is a matched rule before supersession and de-duplication.
type candidate struct {
	rule PrepRule
	// axis + subject is the identity supersession groups on. It is namespaced
	// by axis so an equipment slug can never collide with a canonical item that
	// happens to share its name.
	axis    prepAxis
	subject string
	// label is what {item} interpolates to — the ingredient as the cook would
	// say it, or the equipment's catalog name.
	label string
	// order is the rule's position in the file, the tiebreak that keeps output
	// deterministic when priorities are equal.
	order int
}

// DerivePrepTasks derives the lead-time prep for one recipe cooked on one date.
//
// It is pure: no I/O, no database, and no clock. The cook date is an argument
// precisely because deriving against "now" is the bug this feature exists to
// avoid — a task that says "take the chicken out tonight" is worthless if it is
// computed on the morning you cook.
func DerivePrepTasks(r Recipe, cookDate time.Time) []PrepTask {
	return prepRuleSet.derive(r, cookDate)
}

func (rs *PrepRuleSet) derive(r Recipe, cookDate time.Time) []PrepTask {
	methods := map[string]bool{}
	for _, m := range r.Methods {
		methods[m] = true
	}
	equipment := map[string]bool{}
	for _, e := range r.Equipment {
		// Optional equipment counts. "Or use a grill pan" still means the cook
		// may light a grill, and a prep task is a prompt, not an obligation.
		equipment[e.ID] = true
	}

	cands := make([]candidate, 0, len(rs.rules))
	for i, rule := range rs.rules {
		switch rule.axis() {
		case axisMethod:
			if methods[rule.When.Method] {
				cands = append(cands, candidate{rule, axisMethod, rule.When.Method, rule.When.Method, i})
			}
		case axisEquipment:
			if equipment[rule.When.Equipment] {
				label := rule.When.Equipment
				if e, ok := equipmentCatalog.byID[rule.When.Equipment]; ok {
					label = strings.ToLower(e.Name)
				}
				cands = append(cands, candidate{rule, axisEquipment, rule.When.Equipment, label, i})
			}
		case axisIngredient:
			for _, ing := range r.Ingredients {
				if sub, label, ok := matchIngredient(rule, ing); ok {
					cands = append(cands, candidate{rule, axisIngredient, sub, label, i})
				}
			}
		}
	}
	return rs.resolve(cands, cookDate)
}

// matchIngredient reports whether one rule matches one ingredient line, and
// returns the canonical subject and the label {item} interpolates to.
func matchIngredient(rule PrepRule, ing Ingredient) (subject, label string, ok bool) {
	d := prepItemDetails(ing.Item)
	if d.CanonicalItem == "" {
		return "", "", false
	}
	if rule.When.CanonicalItem != "" && rule.When.CanonicalItem != d.CanonicalItem {
		return "", "", false
	}
	if rule.When.Category != "" && rule.When.Category != d.Category {
		return "", "", false
	}
	if rule.When.IngredientState != "" && !ingredientStates(ing)[rule.When.IngredientState] {
		return "", "", false
	}
	if rule.When.MinQuantityLb > 0 {
		lb, known := quantityLb(ing)
		if !known || lb < rule.When.MinQuantityLb {
			return "", "", false
		}
	}
	// The canonical item, not the display name: canonical keys are lowercase
	// singular nouns, which is exactly what reads correctly mid-sentence in
	// "Move the chicken breast to the fridge".
	return d.CanonicalItem, d.CanonicalItem, true
}

// resolve turns matched rules into the final task list. Three passes, in order,
// each collapsing a different kind of duplicate:
//
//  1. **Same key.** One rule matching two lines that canonicalize to the same
//     item is one task, not two.
//  2. **Priority supersession, per subject.** When several rules produce the
//     same subject the highest priority wins outright — this is how the
//     large-frozen-roast rule replaces the generic thaw instead of the cook
//     being told to thaw the same turkey twice. Equal priorities both survive:
//     neither is higher, and they are describing different work.
//  3. **Same advice.** Different rules can reach identical text — a recipe
//     tagged both `bake` and the `oven` equipment should say "Preheat the oven"
//     once. The surviving rule is deterministic (highest priority, then file
//     order), so the task's key is stable too.
func (rs *PrepRuleSet) resolve(cands []candidate, cookDate time.Time) []PrepTask {
	// Highest priority first, then file order, so every pass below keeps the
	// winner simply by keeping the first entry it sees.
	sort.SliceStable(cands, func(i, j int) bool {
		if cands[i].rule.Priority != cands[j].rule.Priority {
			return cands[i].rule.Priority > cands[j].rule.Priority
		}
		return cands[i].order < cands[j].order
	})

	best := map[string]int{} // axis+subject -> winning priority
	for _, c := range cands {
		g := string(c.axis) + "\x00" + c.subject
		if p, ok := best[g]; !ok || c.rule.Priority > p {
			best[g] = c.rule.Priority
		}
	}

	seenKey := map[string]bool{}
	seenText := map[string]bool{}
	out := make([]PrepTask, 0, len(cands))
	for _, c := range cands {
		g := string(c.axis) + "\x00" + c.subject
		if c.rule.Priority < best[g] {
			continue
		}
		key := c.rule.ID + ":" + c.subject
		if seenKey[key] {
			continue
		}
		text := strings.ReplaceAll(c.rule.Text, "{item}", c.label)
		if seenText[text] {
			continue
		}
		seenKey[key] = true
		seenText[text] = true
		out = append(out, PrepTask{
			Key:     key,
			RuleID:  c.rule.ID,
			Subject: c.subject,
			Window:  c.rule.Window,
			Text:    text,
			Source:  PrepSourceRule,
			DueOn:   dueOn(c.rule.Window, cookDate),
		})
	}

	// Present coarsest window first: the three-day thaw is both the most urgent
	// to see and the easiest to miss. Within a window, by text, so the order
	// never depends on which rule happened to match first.
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Window != out[j].Window {
			return prepWindowIdx[out[i].Window] < prepWindowIdx[out[j].Window]
		}
		return out[i].Text < out[j].Text
	})
	return out
}

// dueOn resolves a window against the cook date. Date arithmetic runs on the
// cook date's own location so a plan never slips a day for a caller in another
// timezone.
func dueOn(w PrepWindow, cookDate time.Time) string {
	lead := 0
	if i, ok := prepWindowIdx[w]; ok {
		lead = prepWindows[i].LeadDays
	}
	y, m, d := cookDate.Date()
	return time.Date(y, m, d-lead, 0, 0, 0, 0, cookDate.Location()).Format(isoDate)
}

// MarkMissed flags every task whose due date has already passed.
//
// It is separate from derivation because derivation has no clock and must not
// grow one: "has this been missed" depends on the *caller's* today, which for a
// browser is a local date the server cannot compute. Nothing is ever removed —
// a missed task is the one the cook most needs to see.
func MarkMissed(tasks []PrepTask, today string) []PrepTask {
	if today == "" {
		return tasks
	}
	out := make([]PrepTask, len(tasks))
	copy(out, tasks)
	for i := range out {
		// ISO dates are lexicographically ordered, so this comparison needs no
		// parsing and no timezone.
		out[i].Missed = out[i].DueOn < today
	}
	return out
}
