package recipe

import (
	"errors"
	"fmt"
	"slices"
	"sort"
	"strings"
	"time"
)

// The three producers of prep tasks (BL-0044). BL-0042 shipped only "rule";
// this file adds the two that cannot be re-derived and merges all three.
//
// The order below is the precedence order, weakest first: a hand-authored task
// beats a model-derived one, which beats the rule table. Precedence is applied
// per task Key, so a manual task *replaces* the rule task it shares a key with
// instead of appearing next to it — which is the whole reason BL-0042 was asked
// for stable keys.
const (
	PrepSourceLLM    = "llm"
	PrepSourceManual = "manual"
)

// prepSourceRank orders the producers. An unrecognized source ranks below all
// of them: an unknown producer must never silently outrank a known one.
func prepSourceRank(source string) int {
	switch source {
	case PrepSourceManual:
		return 3
	case PrepSourceLLM:
		return 2
	case PrepSourceRule:
		return 1
	default:
		return 0
	}
}

// Limits on what one recipe may carry. Both are generous for real use and exist
// so a buggy client (or a model that decides everything needs prep) cannot turn
// one recipe into an unbounded write.
const (
	maxPrepTaskTextLen    = 200
	maxPrepTasksPerRecipe = 25
)

// StoredPrepTask is a prep task that cannot be recomputed: one a person typed,
// or one the model produced at import. Rule-derived prep is deliberately *not*
// stored — it is re-derived on every read so improving a rule improves every
// recipe at once — which is why this type carries no rule id and no due date.
//
// It is the persisted shape of `recipe_prep_tasks`.
type StoredPrepTask struct {
	// Key is the merge identity, shared with PrepTask.Key.
	//
	// A task authored to *override* a derived one carries that task's key
	// verbatim; that is how "the rule is wrong for this recipe" is expressed.
	// A task authored fresh gets a key derived from its own text
	// (`manual:take-the-turkey-out`) rather than a random id, so saving the same
	// form twice cannot produce two rows saying the same thing. The tradeoff is
	// deliberate and the opposite of the rule table's: editing a rule's text
	// preserves check-off because the rule is shared by every recipe, whereas
	// rewriting your own task's text is closer to writing a different task.
	Key    string     `json:"key"`
	Window PrepWindow `json:"window"`
	Text   string     `json:"text"`
	Source string     `json:"source"`
}

// normPrepTasks replaces a nil slice with an empty one so a recipe always
// marshals `prepTasks` as [] rather than null — a null there is a runtime crash
// in every client that maps over it.
func normPrepTasks(tasks []StoredPrepTask) []StoredPrepTask {
	if tasks == nil {
		return []StoredPrepTask{}
	}
	return tasks
}

// ErrPrepTaskInvalid is returned by NormalizePrepTasks for anything a client
// sent that cannot be stored. It is a 400, never a 500.
var ErrPrepTaskInvalid = errors.New("invalid prep task")

// prepSourcesIn reports which producers a batch of tasks carries.
func prepSourcesIn(tasks []StoredPrepTask) map[string]bool {
	out := map[string]bool{}
	for _, t := range tasks {
		out[t.Source] = true
	}
	return out
}

// overlayPrepBySource replaces, per producer, the rows a whole-recipe write
// supplies — and leaves every producer it says nothing about untouched.
//
// This is what keeps a re-seed or a re-import from deleting prep it knows
// nothing about: a recipe upsert that carries no llm tasks is asserting nothing
// about llm tasks, not asserting that there are none.
func overlayPrepBySource(existing, incoming []StoredPrepTask) []StoredPrepTask {
	replaced := prepSourcesIn(incoming)
	out := make([]StoredPrepTask, 0, len(existing)+len(incoming))
	for _, t := range existing {
		if !replaced[t.Source] {
			out = append(out, t)
		}
	}
	return append(out, incoming...)
}

// replacePrepSource swaps out exactly one producer's rows, including when the
// replacement is empty. That last part is why it is not overlayPrepBySource:
// clearing every task you wrote is a thing a user does, and it must not read as
// "said nothing about manual tasks".
func replacePrepSource(existing []StoredPrepTask, source string, tasks []StoredPrepTask) []StoredPrepTask {
	out := make([]StoredPrepTask, 0, len(existing)+len(tasks))
	for _, t := range existing {
		if t.Source != source {
			out = append(out, t)
		}
	}
	return append(out, tasks...)
}

// NormalizePrepTasks validates a batch of authored tasks and canonicalizes them
// for storage: text trimmed, source defaulted, key filled in where the client
// did not supply one, and duplicates by key collapsed.
//
// defaultSource is the producer on whose behalf the caller is writing — the
// recipe form writes "manual", import writes "llm" — and a task may not claim a
// different one. That keeps provenance a fact about *who wrote the row* rather
// than a client-supplied label, which matters because provenance is what the UI
// uses to tell "your note" from "our guess".
// NormalizePrepTasksBySource splits an authored batch by the producer each task
// declares and normalizes each group, rejecting any producer not in allowed.
//
// A task that declares nothing belongs to allowed[0] — the caller's own
// producer. This exists for one path: saving a recipe straight after an import,
// where the payload legitimately carries both the model's tags and whatever the
// user typed in the same form. Everywhere else takes a single source, which is
// why `rule` is storable from nowhere at all.
func NormalizePrepTasksBySource(tasks []StoredPrepTask, allowed ...string) (map[string][]StoredPrepTask, error) {
	if len(allowed) == 0 {
		return nil, fmt.Errorf("%w: no producer allowed here", ErrPrepTaskInvalid)
	}
	groups := map[string][]StoredPrepTask{}
	for _, t := range tasks {
		source := t.Source
		if source == "" {
			source = allowed[0]
		}
		if !slices.Contains(allowed, source) {
			return nil, fmt.Errorf("%w: cannot write a %q task here", ErrPrepTaskInvalid, t.Source)
		}
		t.Source = source
		groups[source] = append(groups[source], t)
	}
	out := make(map[string][]StoredPrepTask, len(groups))
	for source, group := range groups {
		norm, err := NormalizePrepTasks(group, source)
		if err != nil {
			return nil, err
		}
		out[source] = norm
	}
	return out, nil
}

func NormalizePrepTasks(tasks []StoredPrepTask, defaultSource string) ([]StoredPrepTask, error) {
	if len(tasks) > maxPrepTasksPerRecipe {
		return nil, fmt.Errorf("%w: at most %d prep tasks per recipe", ErrPrepTaskInvalid, maxPrepTasksPerRecipe)
	}
	out := make([]StoredPrepTask, 0, len(tasks))
	seen := map[string]bool{}
	for _, t := range tasks {
		text := strings.Join(strings.Fields(t.Text), " ")
		if text == "" {
			// Silently dropped, not rejected: an empty row is what a form's
			// "+ prep task" button leaves behind when the user changes their
			// mind, and failing the whole save over it is hostile.
			continue
		}
		if len(text) > maxPrepTaskTextLen {
			return nil, fmt.Errorf("%w: text is longer than %d characters", ErrPrepTaskInvalid, maxPrepTaskTextLen)
		}
		if _, ok := prepWindowIdx[t.Window]; !ok {
			return nil, fmt.Errorf("%w: unknown window %q", ErrPrepTaskInvalid, t.Window)
		}
		if t.Source != "" && t.Source != defaultSource {
			return nil, fmt.Errorf("%w: cannot write a %q task here", ErrPrepTaskInvalid, t.Source)
		}
		key := strings.TrimSpace(t.Key)
		if key == "" {
			key = defaultSource + ":" + prepKeySlug(text)
		}
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, StoredPrepTask{Key: key, Window: t.Window, Text: text, Source: defaultSource})
	}
	return out, nil
}

// prepKeySlug reduces text to a stable, readable key fragment. Readable because
// these keys show up in logs and in Convex's check-off rows, where
// `manual:take-the-turkey-out` is debuggable and a random id is not.
func prepKeySlug(text string) string {
	var b strings.Builder
	lastDash := true // leading dashes are suppressed by starting "after" one
	for _, r := range strings.ToLower(text) {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			b.WriteRune(r)
			lastDash = false
		default:
			if !lastDash {
				b.WriteByte('-')
				lastDash = true
			}
		}
	}
	slug := strings.Trim(b.String(), "-")
	const maxSlug = 60
	if len(slug) > maxSlug {
		slug = strings.Trim(slug[:maxSlug], "-")
	}
	if slug == "" {
		// Text that is entirely punctuation still needs a key. It is a
		// degenerate case, not an error — the row is real, it just has nothing
		// to slug.
		return "task"
	}
	return slug
}

// MergePrepTasks folds a recipe's stored tasks into its derived ones: three
// producers, one stream, one precedence order (manual > llm > rule).
//
// Deduplication is by Key. A stored task whose key matches a derived one
// replaces it outright — the cook is told to thaw the turkey once, in the words
// they chose — and a stored task with a key nothing else claims is simply added.
// cookDate resolves each stored task's window into its due date exactly as
// derivation does, so a manual task participates in lead time like any other.
func MergePrepTasks(derived []PrepTask, stored []StoredPrepTask, cookDate time.Time) []PrepTask {
	byKey := make(map[string]PrepTask, len(derived)+len(stored))
	order := make([]string, 0, len(derived)+len(stored))

	keep := func(t PrepTask) {
		prev, ok := byKey[t.Key]
		if !ok {
			order = append(order, t.Key)
			byKey[t.Key] = t
			return
		}
		// Strictly greater: equal ranks mean two rows of the same producer, and
		// the first one written wins so the result never depends on map order.
		if prepSourceRank(t.Source) > prepSourceRank(prev.Source) {
			byKey[t.Key] = t
		}
	}

	for _, t := range derived {
		keep(t)
	}
	for _, s := range stored {
		ruleID, subject := splitPrepKey(s.Key)
		keep(PrepTask{
			Key:     s.Key,
			RuleID:  ruleID,
			Subject: subject,
			Window:  s.Window,
			Text:    s.Text,
			Source:  s.Source,
			DueOn:   dueOn(s.Window, cookDate),
		})
	}

	out := make([]PrepTask, 0, len(order))
	for _, k := range order {
		out = append(out, byKey[k])
	}
	// Same ordering rule as derivation: coarsest window first, then by text, so
	// merging never reshuffles a list the user has already learned to read.
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Window != out[j].Window {
			return prepWindowIdx[out[i].Window] < prepWindowIdx[out[j].Window]
		}
		return out[i].Text < out[j].Text
	})
	return out
}

// splitPrepKey recovers the two halves of a key. For an override of a rule task
// they are the rule id and its subject; for a freshly authored task they are the
// producer and the text slug. Reporting them either way keeps the wire shape
// uniform, and a client that only wants to group tasks gets something useful in
// both cases without parsing keys itself.
func splitPrepKey(key string) (ruleID, subject string) {
	if i := strings.Index(key, ":"); i >= 0 {
		return key[:i], key[i+1:]
	}
	return key, ""
}
