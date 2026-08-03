package pricing

import (
	"reflect"
	"testing"
)

func testMapping() MappingFile {
	return MappingFile{Buckets: map[string]Bucket{
		"beef": {
			SeriesID: "S-BEEF", Label: "Beef",
			Match: []string{"beef"},
		},
		"ground-beef": {
			SeriesID: "S-GROUND", Label: "Ground beef",
			Match: []string{"ground beef"},
		},
		"chicken": {
			SeriesID: "S-CHICKEN", Label: "Chicken",
			Match:   []string{"chicken"},
			Exclude: []string{"chicken broth", "chicken stock"},
		},
		"chicken-breast": {
			SeriesID: "S-BREAST", Label: "Chicken breast",
			Match: []string{"chicken breast"},
		},
		"milk": {
			SeriesID: "S-MILK", Label: "Milk",
			Match:   []string{"milk"},
			Exclude: []string{"almond milk", "oat milk"},
		},
		"eggs": {
			SeriesID: "S-EGGS", Label: "Eggs",
			Match: []string{"egg"},
		},
		"strawberries": {
			SeriesID: "S-BERRY", Label: "Strawberries",
			Match: []string{"strawberry"},
		},
		"tomatoes": {
			SeriesID: "S-TOM", Label: "Tomatoes",
			Match: []string{"tomato"},
		},
	}}
}

func mustMatcher(t *testing.T) *Matcher {
	t.Helper()
	m, err := NewMatcher(testMapping())
	if err != nil {
		t.Fatalf("NewMatcher: %v", err)
	}
	return m
}

func TestLookupLongestPhraseWins(t *testing.T) {
	m := mustMatcher(t)
	cases := []struct{ in, want string }{
		// The whole point: a more specific bucket must beat a generic one
		// without any hand-maintained priority ordering.
		{"ground beef", "ground-beef"},
		{"lean ground beef", "ground-beef"},
		{"beef", "beef"},
		{"chicken breast", "chicken-breast"},
		{"boneless skinless chicken breasts", "chicken-breast"},
		{"chicken", "chicken"},
	}
	for _, c := range cases {
		got, _, ok := m.Lookup(c.in)
		if !ok || got != c.want {
			t.Errorf("Lookup(%q) = %q ok=%v, want %q", c.in, got, ok, c.want)
		}
	}
}

func TestLookupExclusionsDisqualify(t *testing.T) {
	m := mustMatcher(t)
	// Priced as chicken, these would be wildly wrong: broth is not poultry and
	// almond milk is not dairy.
	for _, in := range []string{"chicken broth", "chicken stock", "almond milk", "oat milk"} {
		if key, _, ok := m.Lookup(in); ok {
			t.Errorf("Lookup(%q) matched %q, want no match", in, key)
		}
	}
}

func TestLookupMatchesWholeWordsOnly(t *testing.T) {
	m := mustMatcher(t)
	// "egg" must not match inside "eggplant"; substring matching would price a
	// vegetable as poultry.
	if key, _, ok := m.Lookup("eggplant"); ok {
		t.Errorf("Lookup(\"eggplant\") matched %q, want no match", key)
	}
	if key, _, ok := m.Lookup("eggs"); !ok || key != "eggs" {
		t.Errorf("Lookup(\"eggs\") = %q ok=%v, want eggs", key, ok)
	}
}

func TestLookupPlurals(t *testing.T) {
	m := mustMatcher(t)
	cases := []struct{ in, want string }{
		{"strawberries", "strawberries"},
		{"strawberry", "strawberries"},
		{"tomatoes", "tomatoes"},
		{"tomato", "tomatoes"},
		{"eggs", "eggs"},
	}
	for _, c := range cases {
		got, _, ok := m.Lookup(c.in)
		if !ok || got != c.want {
			t.Errorf("Lookup(%q) = %q ok=%v, want %q", c.in, got, ok, c.want)
		}
	}
}

func TestLookupUnknownReturnsNoMatch(t *testing.T) {
	m := mustMatcher(t)
	for _, in := range []string{"saffron", "", "   ", "za'atar"} {
		if key, _, ok := m.Lookup(in); ok {
			t.Errorf("Lookup(%q) matched %q, want no match", in, key)
		}
	}
}

// Go randomizes map iteration, so a matcher that leaned on it would resolve
// differently between runs. Rebuild it repeatedly and assert stability.
func TestLookupIsDeterministic(t *testing.T) {
	const in = "ground beef"
	want, _, _ := mustMatcher(t).Lookup(in)
	for i := 0; i < 50; i++ {
		if got, _, _ := mustMatcher(t).Lookup(in); got != want {
			t.Fatalf("run %d: Lookup(%q) = %q, want %q", i, in, got, want)
		}
	}
}

func TestNewMatcherRejectsBadMappings(t *testing.T) {
	t.Run("no match phrases", func(t *testing.T) {
		_, err := NewMatcher(MappingFile{Buckets: map[string]Bucket{
			"empty": {SeriesID: "S", Label: "Empty"},
		}})
		if err == nil {
			t.Fatal("want error for a bucket with no match phrases")
		}
	})
	t.Run("duplicate phrase across buckets", func(t *testing.T) {
		_, err := NewMatcher(MappingFile{Buckets: map[string]Bucket{
			"a": {SeriesID: "S1", Label: "A", Match: []string{"rice"}},
			"b": {SeriesID: "S2", Label: "B", Match: []string{"rices"}}, // folds to "rice"
		}})
		if err == nil {
			t.Fatal("want error for a phrase claimed by two buckets")
		}
	})
}

func TestFoldTokens(t *testing.T) {
	cases := []struct {
		in   string
		want []string
	}{
		{"Boneless, Skinless Chicken Breasts", []string{"boneless", "skinless", "chicken", "breast"}},
		{"strawberries", []string{"strawberry"}},
		{"tomatoes", []string{"tomato"}},
		{"glass", []string{"glass"}}, // -ss must survive, not become "glas"
		// Irregulars fold to a non-word stem, which is harmless as long as it is
		// stable: authored phrases go through exactly the same function.
		{"molasses", []string{"molasse"}},
		{"2% milk", []string{"2%", "milk"}},
		{"  ", nil},
	}
	for _, c := range cases {
		got := foldTokens(c.in)
		if len(got) == 0 && len(c.want) == 0 {
			continue
		}
		if !reflect.DeepEqual(got, c.want) {
			t.Errorf("foldTokens(%q) = %v, want %v", c.in, got, c.want)
		}
	}
}
