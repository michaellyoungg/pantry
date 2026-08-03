package recipe

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
	"strings"
)

//go:embed equipment.json
var equipmentJSON []byte

// Equipment is one entry of the curated hardware catalog. It is reference data
// shipped with the service, not user data: recipes and (later) user inventories
// reference entries by ID.
//
// Aliases serve double duty — they drive the deterministic import scan AND are
// the vocabulary a recipe page is written in, so one table keeps detection and
// display from drifting apart.
type Equipment struct {
	ID       string   `json:"id"`
	Name     string   `json:"name"`
	Category string   `json:"category"` // appliance | cookware | tool
	Aliases  []string `json:"aliases"`
	// Implies lists methods that follow unambiguously from the equipment
	// ("crock pot" means slow_cook). Empty where the mapping is not certain —
	// a stand mixer says nothing about how the dish is cooked.
	Implies []string `json:"implies,omitempty"`
}

// CookingMethod is one member of the closed method enum. It is closed on
// purpose: BL-0042's prep rules key on these values, and rules cannot be
// written against a vocabulary that varies per recipe.
type CookingMethod struct {
	ID      string   `json:"id"`
	Name    string   `json:"name"`
	Aliases []string `json:"aliases"`
	// JSONLDAliases are only trusted inside schema.org `cookingMethod`, where
	// the value is an explicit declaration rather than prose. "baking" belongs
	// here and not in Aliases: a step saying "line a baking sheet" or "add the
	// baking soda" is about hardware and ingredients, not about method.
	JSONLDAliases []string `json:"jsonldAliases,omitempty"`
}

// RecipeEquipment is one equipment tag on a recipe. Required = false keeps
// "a grill pan works too" expressible, and keeps optional gear from blocking
// BL-0043's "can I make this?" check.
type RecipeEquipment struct {
	ID       string `json:"id"`
	Required bool   `json:"required"`
}

var equipmentCategories = map[string]bool{"appliance": true, "cookware": true, "tool": true}

type equipmentData struct {
	Methods   []CookingMethod `json:"methods"`
	Equipment []Equipment     `json:"equipment"`
}

// aliasMatcher binds one compiled alias pattern to the catalog id it detects.
type aliasMatcher struct {
	re *regexp.Regexp
	id string
}

// EquipmentCatalog is the loaded equipment + method reference data plus the
// compiled alias matchers used by import detection. Built once at init; all
// methods are pure reads and safe for concurrent use.
type EquipmentCatalog struct {
	equipment   []Equipment
	byID        map[string]Equipment
	methods     []CookingMethod
	methodIdx   map[string]int // method id -> position in the enum, for stable ordering
	equipAlias  []aliasMatcher
	methodAlias []aliasMatcher
	// methodJSONLD holds the looser vocabulary used only by MethodsFromJSONLD.
	methodJSONLD []aliasMatcher
}

func loadEquipmentCatalog(raw []byte) (*EquipmentCatalog, error) {
	var d equipmentData
	if err := json.Unmarshal(raw, &d); err != nil {
		return nil, fmt.Errorf("parse equipment.json: %w", err)
	}
	c := &EquipmentCatalog{
		equipment: d.Equipment,
		methods:   d.Methods,
		byID:      make(map[string]Equipment, len(d.Equipment)),
		methodIdx: make(map[string]int, len(d.Methods)),
	}

	seenAlias := map[string]string{}
	for i, m := range d.Methods {
		if strings.TrimSpace(m.ID) == "" || strings.TrimSpace(m.Name) == "" {
			return nil, fmt.Errorf("method %d: id and name are required", i)
		}
		if _, dup := c.methodIdx[m.ID]; dup {
			return nil, fmt.Errorf("method %q: duplicate id", m.ID)
		}
		c.methodIdx[m.ID] = i
		matchers, err := compileAliases(m.ID, m.Aliases, seenAlias)
		if err != nil {
			return nil, fmt.Errorf("method %q: %w", m.ID, err)
		}
		c.methodAlias = append(c.methodAlias, matchers...)
		if len(m.JSONLDAliases) > 0 {
			ldMatchers, err := compileAliases(m.ID, m.JSONLDAliases, seenAlias)
			if err != nil {
				return nil, fmt.Errorf("method %q: %w", m.ID, err)
			}
			c.methodJSONLD = append(c.methodJSONLD, ldMatchers...)
		}
	}

	seenAlias = map[string]string{}
	for i, e := range d.Equipment {
		if strings.TrimSpace(e.ID) == "" || strings.TrimSpace(e.Name) == "" {
			return nil, fmt.Errorf("equipment %d: id and name are required", i)
		}
		if _, dup := c.byID[e.ID]; dup {
			return nil, fmt.Errorf("equipment %q: duplicate id", e.ID)
		}
		if !equipmentCategories[e.Category] {
			return nil, fmt.Errorf("equipment %q: unknown category %q", e.ID, e.Category)
		}
		for _, m := range e.Implies {
			if _, ok := c.methodIdx[m]; !ok {
				return nil, fmt.Errorf("equipment %q: implies unknown method %q", e.ID, m)
			}
		}
		c.byID[e.ID] = e
		matchers, err := compileAliases(e.ID, e.Aliases, seenAlias)
		if err != nil {
			return nil, fmt.Errorf("equipment %q: %w", e.ID, err)
		}
		c.equipAlias = append(c.equipAlias, matchers...)
	}

	// Longest alias first so "cast iron skillet" is attributed to the cast-iron
	// entry before the bare "skillet" pattern can also claim the same phrase.
	sort.SliceStable(c.equipAlias, func(i, j int) bool {
		return len(c.equipAlias[i].re.String()) > len(c.equipAlias[j].re.String())
	})
	return c, nil
}

// compileAliases turns one entry's aliases into word-boundary matchers, holding
// the alias vocabulary unambiguous: the same phrase may not point at two ids.
func compileAliases(id string, aliases []string, seen map[string]string) ([]aliasMatcher, error) {
	if len(aliases) == 0 {
		return nil, fmt.Errorf("at least one alias is required")
	}
	out := make([]aliasMatcher, 0, len(aliases))
	for _, a := range aliases {
		norm := strings.ToLower(strings.TrimSpace(a))
		if norm == "" {
			return nil, fmt.Errorf("empty alias")
		}
		if owner, dup := seen[norm]; dup {
			return nil, fmt.Errorf("alias %q already belongs to %q", norm, owner)
		}
		seen[norm] = id
		out = append(out, aliasMatcher{re: regexp.MustCompile(`\b` + regexp.QuoteMeta(norm) + `\b`), id: id})
	}
	return out, nil
}

var equipmentCatalog = mustLoadEquipmentCatalog()

func mustLoadEquipmentCatalog() *EquipmentCatalog {
	c, err := loadEquipmentCatalog(equipmentJSON)
	if err != nil {
		panic(fmt.Sprintf("load equipment.json: %v", err))
	}
	return c
}

// EquipmentList returns the curated catalog in file order — the shape the
// equipment picker and (in BL-0043) the inventory UI read.
func EquipmentList() []Equipment { return equipmentCatalog.List() }

func (c *EquipmentCatalog) List() []Equipment {
	out := make([]Equipment, len(c.equipment))
	copy(out, c.equipment)
	return out
}

// Methods returns the closed method enum in canonical order.
func (c *EquipmentCatalog) Methods() []CookingMethod {
	out := make([]CookingMethod, len(c.methods))
	copy(out, c.methods)
	return out
}

func (c *EquipmentCatalog) HasEquipment(id string) bool { _, ok := c.byID[id]; return ok }

func (c *EquipmentCatalog) HasMethod(id string) bool { _, ok := c.methodIdx[id]; return ok }

// DetectTags scans step text for catalog aliases and returns the equipment and
// methods it implies. Detection is deterministic — alias matching only, never an
// LLM (that is BL-0044's fallback, and no API key is configured).
//
// Everything found in the steps is tagged required: the scan cannot tell an
// alternative ("or use a grill pan") from a requirement, and the recipe form
// lets the user demote a tag in one click.
func (c *EquipmentCatalog) DetectTags(steps []string) ([]RecipeEquipment, []string) {
	hay := strings.ToLower(strings.Join(steps, "\n"))
	if strings.TrimSpace(hay) == "" {
		return []RecipeEquipment{}, []string{}
	}

	equip := []RecipeEquipment{}
	methods := []string{}
	seenEquip := map[string]bool{}
	seenMethod := map[string]bool{}

	// The equipment pass runs longest-alias-first over a scratch copy and blanks
	// out each phrase it claims, so "cast iron skillet" is attributed to the
	// cast-iron entry and the broader "skillet" pattern never sees those words.
	// Methods scan the untouched text: an equipment alias that is also a method
	// alias ("sous vide") already contributes through Implies.
	scratch := hay
	for _, m := range c.equipAlias {
		if !m.re.MatchString(scratch) {
			continue
		}
		scratch = m.re.ReplaceAllStringFunc(scratch, blankOut)
		if seenEquip[m.id] {
			continue
		}
		seenEquip[m.id] = true
		equip = append(equip, RecipeEquipment{ID: m.id, Required: true})
		for _, impl := range c.byID[m.id].Implies {
			if !seenMethod[impl] {
				seenMethod[impl] = true
				methods = append(methods, impl)
			}
		}
	}
	for _, m := range c.methodAlias {
		if seenMethod[m.id] || !m.re.MatchString(hay) {
			continue
		}
		seenMethod[m.id] = true
		methods = append(methods, m.id)
	}
	return normEquipment(equip), c.sortMethods(methods)
}

// blankOut replaces a claimed alias with spaces, preserving offsets and word
// boundaries around the neighbouring text.
func blankOut(s string) string { return strings.Repeat(" ", len(s)) }

// MethodsFromJSONLD maps schema.org `cookingMethod` values onto the closed enum
// using the same alias table as the step scan. Values that match nothing are
// dropped — an open vocabulary is exactly what the enum exists to prevent.
func (c *EquipmentCatalog) MethodsFromJSONLD(values []string) []string {
	out := []string{}
	seen := map[string]bool{}
	for _, v := range values {
		hay := strings.ToLower(strings.TrimSpace(v))
		if hay == "" {
			continue
		}
		for _, matchers := range [][]aliasMatcher{c.methodAlias, c.methodJSONLD} {
			for _, m := range matchers {
				if !seen[m.id] && m.re.MatchString(hay) {
					seen[m.id] = true
					out = append(out, m.id)
				}
			}
		}
	}
	return c.sortMethods(out)
}

// sortMethods orders methods by their position in the enum so the same tag set
// always serializes identically, whatever order detection produced it in.
func (c *EquipmentCatalog) sortMethods(methods []string) []string {
	out := make([]string, len(methods))
	copy(out, methods)
	sort.SliceStable(out, func(i, j int) bool { return c.methodIdx[out[i]] < c.methodIdx[out[j]] })
	return out
}

// ValidateTags rejects equipment ids and methods outside the curated catalog.
// The Postgres schema enforces the equipment FK anyway; checking here turns a
// constraint violation into a 400 that names the offending id.
func ValidateTags(equip []RecipeEquipment, methods []string) error {
	for _, e := range equip {
		if !equipmentCatalog.HasEquipment(e.ID) {
			return fmt.Errorf("unknown equipment %q", e.ID)
		}
	}
	for _, m := range methods {
		if !equipmentCatalog.HasMethod(m) {
			return fmt.Errorf("unknown cooking method %q", m)
		}
	}
	return nil
}

// normEquipment drops nil, de-duplicates by id (a duplicate would violate the
// recipe_equipment primary key) and sorts by id so every store returns tags in
// the same order. A required tag wins over an optional one for the same id.
func normEquipment(equip []RecipeEquipment) []RecipeEquipment {
	out := make([]RecipeEquipment, 0, len(equip))
	idx := map[string]int{}
	for _, e := range equip {
		if i, ok := idx[e.ID]; ok {
			out[i].Required = out[i].Required || e.Required
			continue
		}
		idx[e.ID] = len(out)
		out = append(out, e)
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

// normMethods drops nil and duplicates and orders by the enum.
func normMethods(methods []string) []string {
	out := make([]string, 0, len(methods))
	seen := map[string]bool{}
	for _, m := range methods {
		if !seen[m] {
			seen[m] = true
			out = append(out, m)
		}
	}
	return equipmentCatalog.sortMethods(out)
}
