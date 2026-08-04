package recipe

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"strings"
)

//go:embed prep_rules.json
var prepRulesJSON []byte

// PrepWindow is when, relative to the cook date, a piece of prep has to happen.
// The enum is deliberately coarse — day granularity, no clock times — because
// the planner schedules meals onto days and nothing in it knows what time
// dinner is. Upgrading a window to a timestamp later is additive.
type PrepWindow string

const (
	WindowThreeDaysBefore PrepWindow = "three_days_before"
	WindowTwoDaysBefore   PrepWindow = "two_days_before"
	WindowNightBefore     PrepWindow = "night_before"
	WindowMorningOf       PrepWindow = "morning_of"
	WindowHourBefore      PrepWindow = "hour_before"
	WindowAtStart         PrepWindow = "at_start"
)

// PrepWindowDef binds a window to the lead time it implies. LeadDays is what
// turns a window into a concrete due date: dueOn = cookDate - LeadDays.
type PrepWindowDef struct {
	ID       PrepWindow
	LeadDays int
	Label    string
}

// prepWindows is ordered coarsest-first, which is also the order tasks are
// presented in: the thing that has to happen three days out is the thing most
// likely to be missed, so it leads.
var prepWindows = []PrepWindowDef{
	{WindowThreeDaysBefore, 3, "Three days before"},
	{WindowTwoDaysBefore, 2, "Two days before"},
	{WindowNightBefore, 1, "The night before"},
	{WindowMorningOf, 0, "Morning of"},
	{WindowHourBefore, 0, "An hour before"},
	{WindowAtStart, 0, "When you start"},
}

var prepWindowIdx = func() map[PrepWindow]int {
	idx := make(map[PrepWindow]int, len(prepWindows))
	for i, w := range prepWindows {
		idx[w.ID] = i
	}
	return idx
}()

// prepRuleWhen is a rule's match condition. A rule matches on exactly one
// subject axis — an ingredient (by canonical item or by category), a cooking
// method, or a piece of equipment — plus optional qualifiers that only apply to
// the ingredient axis.
type prepRuleWhen struct {
	CanonicalItem string `json:"canonicalItem,omitempty"`
	Category      string `json:"category,omitempty"`
	Method        string `json:"method,omitempty"`
	Equipment     string `json:"equipment,omitempty"`

	// IngredientState is a member of the canonical state vocabulary (see
	// prepStates), not the literal word in the recipe: "thawed", "defrosted"
	// and "frozen" all resolve to `frozen`, because all three mean the cook has
	// to get the thing out of the freezer.
	IngredientState string `json:"ingredientState,omitempty"`
	// MinQuantityLb gates on how much of the ingredient the recipe calls for,
	// converted to pounds. This is the difference between a chicken breast and
	// a turkey: both thaw, on wildly different timescales.
	MinQuantityLb float64 `json:"minQuantityLb,omitempty"`
}

// PrepRule is one entry of the curated rule set. Rules are data, not code:
// adding "light the smoker" is an edit to prep_rules.json, reviewed in a pull
// request like any other content change, with no new branch to deploy.
type PrepRule struct {
	ID   string       `json:"id"`
	When prepRuleWhen `json:"when"`
	// Window is when the task has to happen, relative to the cook date.
	Window PrepWindow `json:"window"`
	// Text is the instruction shown to the cook. `{item}` interpolates the
	// subject — the canonical ingredient, or the equipment's catalog name.
	Text string `json:"text"`
	// Priority resolves rules that produce the same subject: the highest wins
	// and the others are dropped, so the large-roast rule supersedes the
	// generic thaw instead of the cook seeing both.
	Priority int `json:"priority"`
}

// axis reports which subject axis the rule matches on.
func (r PrepRule) axis() prepAxis {
	switch {
	case r.When.Method != "":
		return axisMethod
	case r.When.Equipment != "":
		return axisEquipment
	default:
		return axisIngredient
	}
}

type prepAxis string

const (
	axisIngredient prepAxis = "ingredient"
	axisMethod     prepAxis = "method"
	axisEquipment  prepAxis = "equipment"
)

// prepRuleData is the on-disk shape of prep_rules.json.
type prepRuleData struct {
	// Version identifies the rule set that produced a task. It travels on every
	// response so a surprising task can be traced back to the revision that
	// emitted it, and so a client can tell a re-derivation apart from a rule
	// change. Bump it in the same commit as any rule edit.
	Version string     `json:"version"`
	Rules   []PrepRule `json:"rules"`
}

// PrepRuleSet is the loaded, validated rule table. Built once at init; all
// methods are pure reads and safe for concurrent use.
type PrepRuleSet struct {
	version string
	rules   []PrepRule
}

func loadPrepRules(raw []byte, categories map[string]bool, catalog *EquipmentCatalog) (*PrepRuleSet, error) {
	var d prepRuleData
	if err := json.Unmarshal(raw, &d); err != nil {
		return nil, fmt.Errorf("parse prep_rules.json: %w", err)
	}
	if strings.TrimSpace(d.Version) == "" {
		return nil, fmt.Errorf("version is required")
	}

	seen := map[string]bool{}
	for i, r := range d.Rules {
		if strings.TrimSpace(r.ID) == "" {
			return nil, fmt.Errorf("rule %d: id is required", i)
		}
		if seen[r.ID] {
			return nil, fmt.Errorf("rule %q: duplicate id", r.ID)
		}
		seen[r.ID] = true
		if strings.TrimSpace(r.Text) == "" {
			return nil, fmt.Errorf("rule %q: text is required", r.ID)
		}
		if _, ok := prepWindowIdx[r.Window]; !ok {
			return nil, fmt.Errorf("rule %q: unknown window %q", r.ID, r.Window)
		}

		// Every one of these checks turns a silent no-op into a boot failure. A
		// rule that keys on a misspelled method is not a small bug: it simply
		// never fires, and nothing anywhere reports that it didn't.
		axes := 0
		if r.When.CanonicalItem != "" || r.When.Category != "" {
			axes++
		}
		if r.When.Method != "" {
			axes++
		}
		if r.When.Equipment != "" {
			axes++
		}
		if axes != 1 {
			return nil, fmt.Errorf("rule %q: exactly one of canonicalItem/category, method, or equipment is required", r.ID)
		}
		if r.When.Category != "" && !categories[r.When.Category] {
			return nil, fmt.Errorf("rule %q: no item carries category %q", r.ID, r.When.Category)
		}
		if r.When.Method != "" && !catalog.HasMethod(r.When.Method) {
			return nil, fmt.Errorf("rule %q: unknown cooking method %q", r.ID, r.When.Method)
		}
		if r.When.Equipment != "" && !catalog.HasEquipment(r.When.Equipment) {
			return nil, fmt.Errorf("rule %q: unknown equipment %q", r.ID, r.When.Equipment)
		}
		if r.When.IngredientState != "" {
			if !prepStates[r.When.IngredientState] {
				return nil, fmt.Errorf("rule %q: unknown ingredient state %q", r.ID, r.When.IngredientState)
			}
			if r.axis() != axisIngredient {
				return nil, fmt.Errorf("rule %q: ingredientState only applies to ingredient rules", r.ID)
			}
		}
		if r.When.MinQuantityLb != 0 && r.axis() != axisIngredient {
			return nil, fmt.Errorf("rule %q: minQuantityLb only applies to ingredient rules", r.ID)
		}
	}
	return &PrepRuleSet{version: d.Version, rules: d.Rules}, nil
}

var prepRuleSet = mustLoadPrepRules()

func mustLoadPrepRules() *PrepRuleSet {
	rs, err := loadPrepRules(prepRulesJSON, normalizer.Categories(), equipmentCatalog)
	if err != nil {
		panic(fmt.Sprintf("load prep_rules.json: %v", err))
	}
	return rs
}

// PrepRulesVersion is the revision of the shipped rule table.
func PrepRulesVersion() string { return prepRuleSet.version }

// PrepWindows returns the window enum, coarsest lead time first. Clients render
// the labels; they must not hard-code a second copy of this list.
func PrepWindows() []PrepWindowDef {
	out := make([]PrepWindowDef, len(prepWindows))
	copy(out, prepWindows)
	return out
}
